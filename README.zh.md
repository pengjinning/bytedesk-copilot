# 使用指南

## 本地打包与安装

在项目根目录打开终端，执行以下命令安装依赖并打包扩展。`--ignore-scripts` 会跳过尝试联网更新 VS Code 类型定义的安装钩子；项目已包含所需的 `vscode.d.ts`。打包时使用 `--no-dependencies`，避免 `vsce` 用 npm 检查 pnpm 安装的依赖而报错（当前扩展没有运行时依赖）：

```bash
pnpm install --ignore-scripts
pnpm dlx @vscode/vsce package --no-dependencies
```

打包命令会先编译扩展，成功后在项目根目录生成 `.vsix` 安装包。使用 VS Code 命令行安装：

```bash
code --install-extension ./bytedesk-copilot-*.vsix
```

如果终端提示找不到 `code` 命令，请先在 VS Code 中安装或启用命令行工具，再重新执行安装命令。安装完成后重新加载或重启 VS Code，即可使用该扩展。
