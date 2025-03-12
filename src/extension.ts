// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    const locales = await loadLocales();
    const projectConfig = getProjectConfig();

    let diagnosticRanges: IDiagnosticRange[] = [];
    const provider = vscode.languages.registerHoverProvider(
        ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
        {
            provideHover(document, position, token) {
                const range = document.getWordRangeAtPosition(
                    position,
                    /I18N(?:\.[a-zA-Z0-9_$]+)+/,
                );
                if (!range) {
                    return;
                }
                const word = document.getText(range);
                const translation = getLocaleValue(word.replace('I18N.', ''));
                if (translation) {
                    return new vscode.Hover(translation);
                }
            },
        },
    );

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        // ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
        {
            scheme: 'file',
            pattern: `${projectConfig.extractDir}/*.{ts,js,tsx,jsx}`, // 仅匹配 src/ 目录下的 ts/js/tsx/jsx 文件
        },
        {
            provideCodeActions(document, range) {
                console.log(
                    document.fileName,
                    `${path.relative('.', projectConfig.localeDir)}`,
                );
                const action = new vscode.CodeAction(
                    '提取到 i18n',
                    vscode.CodeActionKind.QuickFix,
                );
                const text = diagnosticRanges.find((diagnostic) =>
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

    const diagnosticCollection =
        vscode.languages.createDiagnosticCollection('chinese-text');

    function updateDecorations(editor: vscode.TextEditor) {
        const document = editor.document;
        const localeDir = path.relative('.', projectConfig.localeDir);
        const extractDir = path.relative('.', projectConfig.extractDir);
        if (
            !document.fileName.includes(extractDir) ||
            document.fileName.includes(localeDir)
        ) {
            return;
        }
        const text = document.getText();
        const decorations: vscode.DecorationOptions[] = [];
        const diagnostics: vscode.Diagnostic[] = [];

        diagnosticRanges = getChineseRange(text);
        diagnosticRanges.forEach(({ range }) => {
            decorations.push({ range });

            const diagnostic = new vscode.Diagnostic(
                range,
                '检测到中文文本，建议提取到 i18n',
                vscode.DiagnosticSeverity.Information,
            );
            diagnostics.push(diagnostic);
        });

        diagnosticCollection.set(editor.document.uri, diagnostics);
    }

    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        updateDecorations(activeEditor);
    }

    vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
            activeEditor = editor;
            if (editor) {
                updateDecorations(editor);
            }
        },
        null,
        context.subscriptions,
    );

    vscode.workspace.onDidChangeTextDocument(
        (event) => {
            if (activeEditor && event.document === activeEditor.document) {
                updateDecorations(activeEditor);
            }
        },
        null,
        context.subscriptions,
    );

    context.subscriptions.push(diagnosticCollection);

    const disposable = vscode.commands.registerCommand(
        'i18n-helper.extract',
        (document: vscode.TextDocument, range: vscode.Range, text: string) => {
            vscode.window.showInformationMessage(`准备提取文本: ${text}`);
            if (!activeEditor) {
                return;
            }
            const rangeTypes = diagnosticRanges.find((diagnostic) =>
                diagnostic.range.isEqual(range),
            )?.type;
            const fileName = activeEditor.document.fileName;
            const fileKey = generateLocaleKey(fileName);
            const defaultLocale = locales?.[projectConfig.sourceLocale];
            const currObj = lodash.get(defaultLocale, fileKey);
            const sortKey = getSortKey(1, currObj);

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
                const { result, mapping } =
                    replaceTemplateExpressions(writeText);
                const mappingString = Object.entries(mapping)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                writeText = result;
                replaceText = `I18N.get(I18N.${fileKey}.${sortKey},{ ${mappingString}})`;
                if (rangeTypes?.includes(Type.JsxAttribute)) {
                    replaceText = `{${replaceText}}`;
                }
            }

            activeEditor.edit((editBuilder) => {
                editBuilder.replace(range, replaceText);
            });
            lodash.set(currObj, sortKey, writeText);
            updateLocaleContent(defaultLocale);
        },
    );

    context.subscriptions.push(provider, codeActionProvider, disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
