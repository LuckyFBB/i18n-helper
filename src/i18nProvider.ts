import * as vscode from 'vscode';
import path from 'path';

import {
    generateLocaleKey,
    getChineseRange,
    getLocaleValue,
    getProjectConfig,
    getSortKey,
    IDiagnosticRange,
    loadLocales,
    replaceTemplateExpressions,
    Type,
    updateLocaleContent,
} from './utils';

const lodash = require('lodash-es');

export default class I18NProvider {
    private diagnosticRanges: IDiagnosticRange[] = [];
    private diagnosticCollection: vscode.DiagnosticCollection;
    private activeEditor: vscode.TextEditor | undefined;
    private locales: any;
    private projectConfig: any;

    constructor(context: vscode.ExtensionContext) {
        this.diagnosticCollection =
            vscode.languages.createDiagnosticCollection('chinese-text');
        this.init(context);
    }

    private async init(context: vscode.ExtensionContext) {
        this.locales = await loadLocales();
        this.projectConfig = getProjectConfig();
        this.activeEditor = vscode.window.activeTextEditor;

        if (this.activeEditor) {
            this.updateDecorations(this.activeEditor);
        }

        // 注册所有事件监听和provider
        this.registerEventListeners(context);
        context.subscriptions.push(
            this.registerHoverProvider(),
            this.registerCodeActionProvider(),
            this.registerExtractCommand(),
            this.diagnosticCollection,
        );
    }

    private registerHoverProvider() {
        return vscode.languages.registerHoverProvider(
            ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
            {
                provideHover: (document, position, token) => {
                    const range = document.getWordRangeAtPosition(
                        position,
                        /I18N(?:\.[a-zA-Z0-9_$]+)+/,
                    );
                    if (!range) {
                        return;
                    }
                    const word = document.getText(range);
                    const translation = getLocaleValue(
                        word.replace('I18N.', ''),
                    );
                    if (translation) {
                        return new vscode.Hover(translation);
                    }
                },
            },
        );
    }

    private registerCodeActionProvider() {
        return vscode.languages.registerCodeActionsProvider(
            {
                scheme: 'file',
                pattern: `**/${path.relative('.', this.projectConfig.extractDir)}/**/*.{ts,js,tsx,jsx}`,
            },
            {
                provideCodeActions: (document, range) => {
                    const action = new vscode.CodeAction(
                        '提取到 i18n',
                        vscode.CodeActionKind.QuickFix,
                    );
                    const text = this.diagnosticRanges.find((diagnostic) =>
                        diagnostic.range.isEqual(range),
                    )?.text;

                    action.command = {
                        command: 'i18n-helper.extract',
                        title: '提取到 i18n',
                        arguments: [document, range, text],
                    };
                    return [action];
                },
            },
            {
                providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
            },
        );
    }

    private updateDecorations(editor: vscode.TextEditor) {
        const document = editor.document;
        const localeDir = path.relative('.', this.projectConfig.localeDir);
        const extractDir = path.relative('.', this.projectConfig.extractDir);

        if (
            !document.fileName.includes(extractDir) ||
            document.fileName.includes(localeDir)
        ) {
            return;
        }

        const text = document.getText();
        const diagnostics: vscode.Diagnostic[] = [];

        this.diagnosticRanges = getChineseRange(text);
        this.diagnosticRanges.forEach(({ range }) => {
            const diagnostic = new vscode.Diagnostic(
                range,
                '检测到中文文本，建议提取到 i18n',
                vscode.DiagnosticSeverity.Information,
            );
            diagnostics.push(diagnostic);
        });

        this.diagnosticCollection.set(editor.document.uri, diagnostics);
    }

    private registerEventListeners(context: vscode.ExtensionContext) {
        vscode.window.onDidChangeActiveTextEditor(
            (editor) => {
                this.activeEditor = editor;
                if (editor) {
                    this.updateDecorations(editor);
                }
            },
            null,
            context.subscriptions,
        );

        vscode.workspace.onDidChangeTextDocument(
            (event) => {
                if (
                    this.activeEditor &&
                    event.document === this.activeEditor.document
                ) {
                    this.updateDecorations(this.activeEditor);
                }
            },
            null,
            context.subscriptions,
        );
    }

    private registerExtractCommand() {
        return vscode.commands.registerCommand(
            'i18n-helper.extract',
            (
                document: vscode.TextDocument,
                range: vscode.Range,
                text: string,
            ) => {
                this.handleExtract(document, range, text);
            },
        );
    }

    private handleExtract(
        document: vscode.TextDocument,
        range: vscode.Range,
        text: string,
    ) {
        if (!this.activeEditor) {
            return;
        }

        const rangeTypes = this.diagnosticRanges.find((diagnostic) =>
            diagnostic.range.isEqual(range),
        )?.type;
        const fileName = this.activeEditor.document.fileName;
        const fileKey = generateLocaleKey(fileName);
        const defaultLocale = this.locales?.[this.projectConfig.sourceLocale];
        const currObj = lodash.get(defaultLocale, fileKey);
        const sortKey = getSortKey(1, currObj);

        const { replaceText, writeText } = this.generateReplaceText(
            text,
            rangeTypes,
            fileKey,
            sortKey,
        );

        this.activeEditor.edit((editBuilder) => {
            editBuilder.replace(range, replaceText);
        });
        lodash.set(currObj, sortKey, writeText);
        updateLocaleContent(defaultLocale);
        vscode.window.showInformationMessage(
            `成功提取文本: ${text}为 ${replaceText}`,
        );
    }

    private generateReplaceText(
        text: string,
        rangeTypes: Type[] | undefined,
        fileKey: string,
        sortKey: string,
    ) {
        let replaceText = `I18N.${fileKey}.${sortKey}`;
        let writeText = text;

        if (
            rangeTypes?.includes(Type.Jsx) ||
            (rangeTypes?.includes(Type.JsxAttribute) &&
                rangeTypes?.includes(Type.String))
        ) {
            replaceText = `{I18N.${fileKey}.${sortKey}}`;
        }

        if (rangeTypes?.includes(Type.Template)) {
            const { result, mapping } = replaceTemplateExpressions(writeText);
            const mappingString = Object.entries(mapping)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
            writeText = result;
            replaceText = `I18N.get(I18N.${fileKey}.${sortKey},{ ${mappingString}})`;
            if (rangeTypes?.includes(Type.JsxAttribute)) {
                replaceText = `{${replaceText}}`;
            }
        }

        return { replaceText, writeText };
    }
}
