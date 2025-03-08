// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { getChineseRange, getLocaleValue, loadLocales } from './utils';
import { readFileSync } from 'fs';

const chineseTextDecoration = vscode.window.createTextEditorDecorationType({
    border: '1px solid red',
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
});

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    loadLocales();
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

    const openDocumentListener = vscode.workspace.onDidOpenTextDocument(
        async (document) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !document) {
                return;
            }
            const fileContent = readFileSync(document.fileName, 'utf-8');
            const ranges = getChineseRange(fileContent);
            // 为每个中文文本创建诊断信息
            const diagnostics = ranges.map((range) => {
                const diagnostic = new vscode.Diagnostic(
                    range,
                    '检测到中文文本',
                    vscode.DiagnosticSeverity.Information,
                );
                diagnostic.source = 'i18n-helper';
                return diagnostic;
            });

            // 设置装饰器和诊断信息
            editor.setDecorations(chineseTextDecoration, ranges);
            vscode.languages
                .createDiagnosticCollection('i18n-helper')
                .set(document.uri, diagnostics);
        },
    );

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
        {
            provideCodeActions(document, range, context, token) {
                // 检查是否有装饰器在这个范围内
                const decorations = context.diagnostics.filter(
                    (diagnostic) =>
                        diagnostic.range.intersection(range) !== undefined,
                );

                if (decorations.length === 0) {
                    return;
                }

                const text = document.getText(range);
                const action = new vscode.CodeAction(
                    '提取到 i18n',
                    vscode.CodeActionKind.QuickFix,
                );

                action.command = {
                    command: 'i18n-helper.extract',
                    title: '提取到 i18n',
                    arguments: [
                        {
                            text,
                            range: {
                                start: range.start,
                                end: range.end,
                            },
                        },
                    ],
                };

                return [action];
            },
        },
    );

    context.subscriptions.push(
        provider,
        openDocumentListener,
        codeActionProvider,
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
