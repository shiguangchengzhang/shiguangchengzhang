# 自动部署到 Sealos

工作流文件：`.github/workflows/deploy-sealos.yml`

## 当前状态

代码已成功推送到：

```text
https://github.com/hhnhhw/shiguangchengzhang
```

分支：`main`

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

## 配置 GitHub Secrets

仓库进入：

```text
Settings → Secrets and variables → Actions → New repository secret
```

新增以下 3 个仓库 Secret：

### DOCKERHUB_USERNAME

```text
hhnhhw
```

### DOCKERHUB_TOKEN

填写 Docker Hub Access Token，不要填写账户密码。

创建地址：

```text
https://hub.docker.com/settings/security
```

建议权限：`Read & Write`。

### SEALOS_KUBECONFIG_B64

填写北京区域 `ns-8zpzccfm` 工作空间 kubeconfig 的 Base64 内容。

先在本机确认 kubeconfig：

```powershell
$env:KUBECONFIG="$env:USERPROFILE\.sealos\kubeconfig"
kubectl config current-context
kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace}'
```

必须输出：

```text
ns-8zpzccfm
```

再生成 Base64：

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("$env:USERPROFILE\.sealos\kubeconfig")
)
```

将完整输出粘贴到 `SEALOS_KUBECONFIG_B64`。不要把 kubeconfig、Token 或 `.env` 提交到仓库。

## 首次运行

Secrets 配置完成后，在 GitHub 页面打开：

```text
Actions → Deploy to Sealos → Run workflow → main → Run workflow
```

或者本地提交代码：

```powershell
git add .
git commit -m "chore: enable Sealos auto deployment"
git push origin main
```

## 线上地址

```text
https://shiguangchengzhang-fxaethpl.sealosbja.site
```

健康检查：

```text
https://shiguangchengzhang-fxaethpl.sealosbja.site/api/health
```

## 回滚

如果新版本异常，可在 Sealos kubeconfig 有效时执行：

```powershell
kubectl --insecure-skip-tls-verify `
  -n ns-8zpzccfm `
  rollout undo deployment/shiguangchengzhang-ouwyqxcl
```

工作流更新的是现有 Deployment 镜像，不会删除或重建公网域名。运行时 AI/讯飞环境变量继续保留在 Sealos Deployment 中，不会写入 GitHub Actions 日志。
