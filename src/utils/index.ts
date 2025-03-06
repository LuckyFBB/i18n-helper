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
    localeDir: './locales',
    extractDir: './',
    importStatement: 'import I18N from @/utils/i18n',
    excludeFile: [],
    excludeDir: ['node_modules', 'locales'],
    type: 'ts',
    sourceLocale: 'zh-CN',
};

export enum LOCALE_FILE_TYPES {
    TS = 'ts',
    JS = 'js',
    JSON = 'json',
}

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

export const getProjectConfig = (): IConfig => {
    const configFile = path.join(
        `${vscode.workspace.rootPath}/i18n.config.json`,
    );
    if (!fs.existsSync(configFile)) {
        throw new Error('尚未找到 i18n.config.json 文件');
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
    try {
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

/**
 * 检测是否包含中文字符
 */
export const containsChinese = (text: string): boolean => {
    return /[\u4e00-\u9fa5]/.test(text);
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
    if (dir) fileKey = names.slice(0, -1).concat(fileKey).join('.');
    return fileKey.replace(/-/g, '_');
};

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

    if (
        [LOCALE_FILE_TYPES.TS, LOCALE_FILE_TYPES.JS].includes(
            type as LOCALE_FILE_TYPES,
        )
    ) {
        const newAst = objectToAst(content);

        const sourceCode = fs.readFileSync(targetFilename, 'utf-8');
        const ast = parse(sourceCode, {
            sourceType: 'module',
            plugins: type === LOCALE_FILE_TYPES.TS ? ['typescript'] : [],
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

/**
 * 分析代码的 AST 上下文
 * @param code 代码内容
 * @param range 文本范围
 * @returns 上下文类型
 */
export const getAstContext = async (
    code: string,
    range: any,
): Promise<string[]> => {
    try {
        const ast = parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties'],
        });

        const contextTypes = new Set<string>(); // 默认为普通文本

        traverse(ast, {
            enter(path) {
                const { node } = path;
                if (!node.loc) {
                    return path.stop();
                }
                // 检查节点位置是否包含目标范围
                if (
                    node.loc.start.line <= range[0].line + 1 &&
                    node.loc.end.line >= range[1].line + 1
                ) {
                    if (babelTypes.isStringLiteral(node)) {
                        contextTypes.add('string');
                    }
                    if (babelTypes.isTemplateLiteral(node)) {
                        contextTypes.add('template');
                    }
                    if (
                        babelTypes.isJSXElement(node) ||
                        babelTypes.isJSXAttribute(node)
                    ) {
                        contextTypes.add('jsx');
                    }
                    if (babelTypes.isObjectProperty(node)) {
                        contextTypes.add('property');
                    }
                }
            },
        });

        return Array.from(contextTypes);
    } catch (error) {
        console.error('AST 分析错误:', error);
        return []; // 出错时返回默认类型
    }
};
