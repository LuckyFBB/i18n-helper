// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { getLocaleValue, loadLocales } from './utils';

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
                if (!range) return;
                const word = document.getText(range);
                const translation = getLocaleValue(word.replace('I18N.', ''));
                if (translation) {
                    return new vscode.Hover(translation);
                }
            },
        },
    );

    context.subscriptions.push(provider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
