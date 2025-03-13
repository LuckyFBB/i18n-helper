import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as babelTypes from '@babel/types';
import generate from '@babel/generator';
import slash from 'slash2';

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
    sourceLocale: 'zh-CN',
};

type IConfig = typeof DEFAULT_CONFIG;

export type IDiagnosticRange = {
    range: vscode.Range;
    type: Type[];
    text: string;
};

export enum Type {
    String = 'string',
    Template = 'template',
    Jsx = 'jsx',
    JsxAttribute = 'jsxAttribute',
}

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

export const getProjectConfig = (): IConfig => {
    const configFile = path.join(
        `${vscode.workspace.rootPath}/i18n.config.json`,
    );
    if (!fs.existsSync(configFile)) {
        throw new Error('当前项目尚未配置 i18n.config.json');
    }
    return {
        ...DEFAULT_CONFIG,
        ...JSON.parse(fs.readFileSync(configFile, 'utf-8')),
    };
};

/**
 * @description 读取文件夹下的语言文件
 */
export const loadLocales = async () => {
    const config = getProjectConfig();
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
    return locales;
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

export const generateLocaleKey = (filePath: string) => {
    const projectConfig = getProjectConfig();

    const basePath = path.resolve(
        vscode.workspace.rootPath || '',
        projectConfig.extractDir,
    );

    const relativePath = path.relative(basePath, filePath);

    const names = slash(relativePath).split('/');
    const fileName = lodash.last(names) as any;
    let fileKey = fileName.split('.').slice(0, -1).join('.');
    const dir = names.slice(0, -1).join('.');
    if (dir) {
        fileKey = names.slice(0, -1).concat(fileKey).join('.');
    }
    return fileKey.replace(/-/g, '_');
};

/**
 * 返回类似 excel 头部的标识
 * @param n number
 * @returns string
 */
export const getSortKey = (n: number, extractMap = {}): string => {
    let label = '';
    let num = n;
    while (num > 0) {
        num--;
        label = String.fromCharCode((num % 26) + 65) + label;
        num = Math.floor(num / 26);
    }
    const key = `${label}`;
    if (lodash.get(extractMap, key)) {
        return getSortKey(n + 1, extractMap);
    }
    return key;
};

export const containsChinese = (value: string) =>
    value.match(/[\u4E00-\u9FFF]/g);

function countNewlinesAndIndentation(str: string) {
    const newlinesMatch = str.match(/^(\n+)/); // 计算前导换行符
    const indentationMatch = str.match(/\s*\n(\s*)\S/); // 计算第一个换行后缩进

    const offsetLines = newlinesMatch ? newlinesMatch[1].length : 0;
    const indentation =
        indentationMatch && offsetLines ? indentationMatch[1].length : 0;

    return {
        offsetLines,
        indentation,
    };
}

export const getChineseRange = (fileContent: string) => {
    const diagnosticRanges: IDiagnosticRange[] = [];
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
                    diagnosticRanges.push({
                        range: new vscode.Range(
                            new vscode.Position(start.line - 1, start.column),
                            new vscode.Position(end.line - 1, end.column),
                        ),
                        type: [Type.String],
                        text: path.node.value,
                    });
                }
            }
        },
        TemplateLiteral(path) {
            const { node } = path;
            const { start, end } = node;
            if (!start || !end) {
                return;
            }
            let templateContent = fileContent.slice(start + 1, end - 1);
            const isTemplate = !!node.expressions.length;

            if (containsChinese(templateContent)) {
                const start = path.node.loc?.start;
                const end = path.node.loc?.end;
                if (start && end) {
                    diagnosticRanges.push({
                        range: new vscode.Range(
                            new vscode.Position(start.line - 1, start.column),
                            new vscode.Position(end.line - 1, end.column),
                        ),
                        type: [isTemplate ? Type.Template : Type.String],
                        text: templateContent,
                    });
                }
            }
        },
        JSXText(path) {
            const { value, loc } = path.node;
            const text = value.trim();
            const { offsetLines, indentation } =
                countNewlinesAndIndentation(value);
            if (containsChinese(text)) {
                const start = loc?.start;
                const end = loc?.end;
                const endWithBreak = /\n\s*$/.test(value);
                const startWithBreak = /^\s*\n/.test(value);
                if (start && end) {
                    diagnosticRanges.push({
                        range: new vscode.Range(
                            new vscode.Position(
                                start.line - 1 + offsetLines,
                                startWithBreak
                                    ? indentation
                                    : start.column + indentation,
                            ),
                            new vscode.Position(
                                end.line - (endWithBreak ? 2 : 1),
                                start.column + indentation + text.length,
                            ),
                        ),
                        type: [Type.Jsx],
                        text,
                    });
                }
            }
        },
        JSXAttribute(path) {
            const { value: childNode } = path.node;
            if (
                babelTypes.isStringLiteral(childNode) &&
                containsChinese(childNode.value)
            ) {
                const start = childNode.loc?.start;
                const end = childNode.loc?.end;
                if (start && end) {
                    diagnosticRanges.push({
                        range: new vscode.Range(
                            new vscode.Position(start.line - 1, start.column),
                            new vscode.Position(end.line - 1, end.column),
                        ),
                        type: [Type.JsxAttribute, Type.String],
                        text: childNode.value,
                    });
                    path.skip();
                }
            }
            if (babelTypes.isJSXExpressionContainer(childNode)) {
                const expression = childNode.expression;
                if (babelTypes.isTemplateLiteral(expression)) {
                    const { start, end } = expression;
                    if (!start || !end) {
                        return;
                    }
                    const isTemplate = !!expression.expressions.length;
                    let templateContent = fileContent.slice(start + 1, end - 1);
                    if (containsChinese(templateContent)) {
                        const start = childNode.loc?.start;
                        const end = childNode.loc?.end;
                        if (start && end) {
                            diagnosticRanges.push({
                                range: new vscode.Range(
                                    new vscode.Position(
                                        start.line - 1,
                                        start.column,
                                    ),
                                    new vscode.Position(
                                        end.line - 1,
                                        end.column,
                                    ),
                                ),
                                type: [
                                    Type.JsxAttribute,
                                    isTemplate ? Type.Template : Type.String,
                                ],
                                text: templateContent,
                            });
                        }
                    }
                    path.skip();
                }
            }
        },
    });

    return diagnosticRanges;
};

export const objectToAst = (
    obj: Record<string, any> | string,
): babelTypes.ObjectExpression => {
    const data = typeof obj === 'string' ? JSON.parse(obj) : obj;
    const properties = Object.entries(data).map(([key, value]) => {
        let valueNode: babelTypes.Expression;
        if (value && typeof value === 'object') {
            valueNode = objectToAst(value);
        } else if (typeof value === 'string') {
            valueNode = babelTypes.stringLiteral(value);
        } else {
            valueNode = babelTypes.valueToNode(value);
        }
        return babelTypes.objectProperty(
            babelTypes.stringLiteral(key),
            valueNode,
        );
    });

    return babelTypes.objectExpression(properties);
};

/**
 * 创建或更新国际化资源文件
 * @param {string} content - 要写入的国际化内容
 */
export const updateLocaleContent = (
    content: Record<string, any>,
    filePath?: string,
) => {
    const { localeDir, type, sourceLocale } = getProjectConfig();
    const targetFilename =
        filePath ||
        path.join(
            vscode.workspace.rootPath || '',
            localeDir,
            `${sourceLocale}/index.${type}`,
        );
    const directory = path.dirname(targetFilename);

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    if (['ts', 'js'].includes(type)) {
        const newAst = objectToAst(content);

        const sourceCode = fs.readFileSync(targetFilename, 'utf-8');
        const ast = parse(sourceCode, {
            sourceType: 'module',
            plugins: type === 'ts' ? ['typescript'] : [],
        });

        let exportedIdentifier: string | null = null;

        traverse(ast, {
            ExportDefaultDeclaration(path) {
                const declaration = path.node.declaration;
                if (babelTypes.isIdentifier(declaration)) {
                    exportedIdentifier = declaration.name;
                }
                if (babelTypes.isObjectExpression(declaration)) {
                    path.node.declaration = newAst;
                }
                path.stop();
            },
        });

        if (exportedIdentifier) {
            traverse(ast, {
                VariableDeclarator(path) {
                    if (
                        babelTypes.isIdentifier(path.node.id) &&
                        path.node.id.name === exportedIdentifier
                    ) {
                        path.node.init = newAst;
                        path.stop();
                    }
                },
            });
        }

        const { code } = generate(ast, {
            jsescOption: {
                minimal: true,
            },
        });
        fs.writeFileSync(targetFilename, code, 'utf8');
        return;
    }

    fs.writeFileSync(targetFilename, JSON.stringify(content, null, 4), 'utf8');
};

export function replaceTemplateExpressions(template: string): {
    result: string;
    mapping: Record<string, string>;
} {
    let count = 1;
    const mapping: Record<string, string> = {};

    const result = template.replace(/\$\{([^}]+)\}/g, (_, varName) => {
        const newVar = `val${count}`;
        mapping[newVar] = varName;
        count++;
        return `{${newVar}}`;
    });

    return { result, mapping };
}
