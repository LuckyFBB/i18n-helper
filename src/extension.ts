// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import {
    containsChinese,
    generateLocaleKey,
    getAstContext,
    getLocaleValue,
    getProjectConfig,
    getSortKey,
    loadLocales,
    updateLocaleContent,
} from './utils';

const lodash = require('lodash-es');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    const locales = await loadLocales();
    const extractCommand = vscode.commands.registerCommand(
        'i18n-helper.extract',
        async (params) => {
            const { text, range } = params || {};
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            if (!text) {
                vscode.window.showWarningMessage('请先选择需要提取的中文文本');
                return;
            }
            const fileName = editor.document.fileName;
            const fileKey = generateLocaleKey(fileName);
            const projectConfig = getProjectConfig();
            const defaultLocale = locales?.[projectConfig.sourceLocale];
            const currObj = lodash.get(defaultLocale, fileKey);
            const sortKey = getSortKey(1, currObj);
            lodash.set(currObj, sortKey, text);
            updateLocaleContent(defaultLocale);

            // 获取当前文件内容
            const fileContent = editor.document.getText();
            // 分析 AST 上下文
            const contextType = await getAstContext(fileContent, range);
            const isString = contextType.includes('string');
            // 创建编辑器范围
            const editorRange = new vscode.Range(
                new vscode.Position(
                    range[0].line,
                    isString ? range[0].character - 1 : range[0].character,
                ),
                new vscode.Position(
                    range[1].line,
                    isString ? range[1].character + 1 : range[1].character,
                ),
            );

            editor.edit((editBuilder) => {
                editBuilder.replace(
                    editorRange,
                    contextType.includes('jsx')
                        ? `{I18N.${fileKey}.${sortKey}}`
                        : contextType.includes('template')
                          ? `\${I18N.${fileKey}.${sortKey}}`
                          : `I18N.${fileKey}.${sortKey}`,
                );
            });
        },
    );
    const provider = vscode.languages.registerHoverProvider(
        ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
        {
            provideHover(document, position, token) {
                const range = document.getWordRangeAtPosition(position);
                if (!range) {
                    return;
                }
                const word = document.getText(range);
                if (word.indexOf('I18N.') === -1) {
                    const translation = getLocaleValue(
                        word.replace('I18N.', ''),
                    );
                    if (translation) {
                        return new vscode.Hover(translation);
                    }
                }
                if (containsChinese(word)) {
                    const actions = [
                        `[提取到 i18n](command:i18n-helper.extract?${encodeURIComponent(
                            JSON.stringify([
                                {
                                    text: word,
                                    range,
                                },
                            ]),
                        )})`,
                    ].join(' | ');
                    const commandUri = new vscode.MarkdownString(actions);
                    commandUri.isTrusted = true;
                    return new vscode.Hover([
                        new vscode.MarkdownString(word),
                        commandUri,
                    ]);
                }
            },
        },
    );

    context.subscriptions.push(provider, extractCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
