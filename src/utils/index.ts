import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as babelTypes from '@babel/types';
const lodash = require('lodash-es');

let locales: Record<string, any> = {};

// i18n.config.json 默认值
const DEFAULT_CONFIG = {
    localeDir: 'locales',
    extractDir: './',
    importStatement: 'import I18N from @/utils/i18n',
    excludeFile: [],
    excludeDir: ['node_modules'],
    type: 'ts',
};

type IConfig = typeof DEFAULT_CONFIG;

/**
 * @param directoryPath 文件夹路径
 * @returns 文件夹下的文件夹数组
 */
const getSubdirectories = async (directoryPath: string): Promise<string[]> => {
    if (!fs.existsSync(directoryPath)) {
        return Promise.reject(`尚未找到 locales 文件`);
    }
    return fs
        .readdirSync(directoryPath)
        .filter((name) =>
            fs.statSync(path.join(directoryPath, name)).isDirectory(),
        );
};

const getProjectConfig = async (): Promise<IConfig> => {
    const configFile = path.join(
        `${vscode.workspace.rootPath}/i18n.config.json`,
    );
    if (!fs.existsSync(configFile)) {
        return Promise.reject('当前项目尚未配置 i18n.config.json');
    }
    return Promise.resolve({
        ...DEFAULT_CONFIG,
        ...JSON.parse(fs.readFileSync(configFile, 'utf-8')),
    });
};

/**
 * @description 读取文件夹下的语言文件
 */
export const loadLocales = async () => {
    try {
        const config = await getProjectConfig();
        const localeDir = path.join(
            vscode.workspace.rootPath || '',
            config.localeDir,
        );
        const subDirs = await getSubdirectories(localeDir);
        const results = await Promise.all(
            subDirs.map((lang) => {
                const filePath = path.join(
                    localeDir,
                    `${lang}/index.${config.type}`,
                );
                return getExportedObject(filePath).then((res) => ({
                    lang,
                    res,
                }));
            }),
        );
        results.forEach(({ lang, res }) => {
            locales[lang] = res;
        });
    } catch (error) {
        vscode.window.showErrorMessage(error as string);
    }
};

/**
 * @param filePath 文件路径
 * @returns 文件中的对象
 */
const getExportedObject = (filePath: string) => {
    const code = fs.readFileSync(filePath, 'utf-8');

    const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript'],
    });

    let exportIdentifier: string = '';
    let exportData: Record<string, any> = {};

    traverse(ast, {
        ExportDefaultDeclaration(path) {
            const declaration = path.node.declaration;
            if (babelTypes.isIdentifier(declaration)) {
                exportIdentifier = declaration.name;
            }
            if (babelTypes.isObjectExpression(declaration)) {
                exportData = eval(
                    `(${code.slice(declaration.start ?? 0, declaration.end ?? 0)})`,
                );
            }
        },
    });

    if (!exportIdentifier && !Object.keys(exportData).length) {
        return Promise.reject(`解析${filePath}文件失败`);
    }

    traverse(ast, {
        VariableDeclarator(path) {
            if (
                path.node.id.type === 'Identifier' &&
                path.node.id.name === exportIdentifier
            ) {
                if (
                    path.node.init &&
                    path.node.init.type === 'ObjectExpression'
                ) {
                    exportData = eval(
                        `(${code.slice(path.node.init.start ?? 0, path.node.init.end ?? 0)})`,
                    );
                }
            }
        },
    });

    return Promise.resolve(exportData);
};

/**
 * @param path I18N 后面的对象地址
 * @returns 对应的文本
 */
export const getLocaleValue = (path: string): string | undefined => {
    const data: Record<string, any> = {};
    for (const key in locales) {
        data[key] = lodash.get(locales[key], path);
    }

    if (Object.keys(data).length) {
        let text = '';
        Object.entries(data).forEach(([key, value]) => {
            text += value ? `${key}: ${value}\n\n` : '';
        });
        return text;
    } else {
        return undefined;
    }
};

export const containsChinese = (value: string) =>
    value.match(/[\u4E00-\u9FFF]/g);

export const getChineseRange = (fileContent: string) => {
    const ranges: vscode.Range[] = [];
    const ast = parse(fileContent, {
        sourceType: 'module',
        plugins: ['decorators-legacy', 'typescript', 'jsx'],
    });

    traverse(ast, {
        StringLiteral(path) {
            if (containsChinese(path.node.value)) {
                const start = path.node.loc?.start;
                const end = path.node.loc?.end;
                if (start && end) {
                    ranges.push(
                        new vscode.Range(
                            new vscode.Position(start.line - 1, start.column),
                            new vscode.Position(end.line - 1, end.column),
                        ),
                    );
                }
            }
        },
        // TODO:
        JSXElement(path) {
            path.node.children.forEach((child) => {
                if (babelTypes.isJSXText(child)) {
                    const text = child.value.trim();
                    if (text && containsChinese(text)) {
                        const start = child.loc?.start;
                        const end = child.loc?.end;
                        if (start && end) {
                            const startOffset = child.value.indexOf(text);
                            ranges.push(
                                new vscode.Range(
                                    new vscode.Position(
                                        start.line - 1,
                                        start.column + startOffset,
                                    ),
                                    new vscode.Position(
                                        end.line - 1,
                                        start.column +
                                            startOffset +
                                            text.length,
                                    ),
                                ),
                            );
                        }
                    }
                }
            });
        },
        JSXAttribute(path) {
            const { value } = path.node;
            if (
                babelTypes.isStringLiteral(value) &&
                containsChinese(value.value)
            ) {
                const start = value.loc?.start;
                const end = value.loc?.end;
                if (start && end) {
                    ranges.push(
                        new vscode.Range(
                            new vscode.Position(start.line - 1, start.column),
                            new vscode.Position(end.line - 1, end.column),
                        ),
                    );
                }
            }
        },
    });

    return ranges;
};
