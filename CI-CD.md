# 自动部署到 Sealos

工作流文件：`.github/workflows/deploy-sealos.yml`

## 发布机制

向 GitHub 仓库的 `main` 分支 push 后，GitHub Actions 会：

1. 构建 `linux/amd64` Docker 镜像；
2. 推送两个标签到 Docker Hub：
   - `hhnhhw/shiguangchengzhang:<commit-sha>`
   - `hhnhhw/shiguangchengzhang:main`
3. 使用 Sealos 北京工作空间 `ns-8zpzccfm` 的 kubeconfig 更新 Deployment；
4. 等待 Deployment rollout 完成；
5. 检查公网地址 `/api/health`。

也可以在 GitHub Actions 页面手动运行 `workflow_dispatch`。

## 必须配置的 GitHub Secrets

仓库进入 **Settings → Secrets and variables → Actions → New repository secret**，新增：

- `DOCKERHUB_USERNAME`：Docker Hub 用户名 `hhnhhw`
- `DOCKERHUB_TOKEN`：Docker Hub Access Token，不要使用账户密码
- `SEALOS_KUBECONFIG_B64`：北京工作空间 `ns-8zpzccfm` 的 kubeconfig 文件 Base64 内容

PowerShell 生成 kubeconfig Base64 的示例：

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("$env:USERPROFILE\.sealos\kubeconfig")
)
```

请确保生成 Base64 时使用的是北京区域、`ns-8zpzccfm` 工作空间对应的 kubeconfig。不要把 kubeconfig、Docker token 或 `.env` 提交到仓库。

## 首次启用

1. 将当前项目上传到 GitHub 仓库；
2. 默认分支设为 `main`；
3. 添加上述 3 个 Secrets；
4. push 一次代码，或在 Actions 页面手动执行工作流；
5. 检查 Actions 日志和公网地址：

   `https://shiguangchengzhang-fxaethpl.sealosbja.site`

## 注意事项

- GitHub Actions 不依赖当前对话，后续 push 会独立触发部署。
- 工作流通过 `kubectl set image` 更新现有 Deployment，不会重建公网域名。
- 镜像使用 commit SHA 标签，便于回滚；`main` 只是辅助标签。
- 当前项目的运行时 AI/讯飞变量继续保留在 Sealos Deployment 中，不会从 GitHub Actions 日志输出。
- 若 GitHub Actions 执行失败，当前线上版本不会因 `rollout status` 失败而自动删除；可在 Sealos 控制台或使用 `kubectl rollout undo` 回滚。
