# 拾光成长 HBuilderX 云打包壳工程

## 作用

原项目是 Node.js 服务 + 单页 HTML，不是可直接在 HBuilderX 中“发行-原生App-云打包”的 uni-app 工程。
本目录是一个最小 uni-app WebView 壳：APK 只负责承载线上前端，业务 API 仍由 Sealos 上的 Node.js 服务提供。

线上地址已配置为：

`https://shiguangchengzhang-fxaethpl.sealosbja.site`

## 在 HBuilderX 中打包

1. 使用 HBuilderX（App开发版）打开本目录；如果提示创建/绑定 DCloud AppID，按账号提示生成正式 AppID，并把 `manifest.json` 中的 `appid` 替换为 HBuilderX 生成的值。
2. 在 `manifest.json` 可视化视图中设置应用图标、版本号、Android 包名。
3. 首次测试可选择云证书；正式发布请使用自己长期保管的 Android 发布证书。
4. 选择菜单：`发行` → `原生App-云打包` → Android → `APK安装包` → 提交打包。
5. 下载生成的 APK，优先在 Android 真机上验证登录、Cookie、录音权限、文件下载和返回键。

## 注意事项

- 这是在线 WebView 包，需要联网；离线时不能打开业务页面。
- 录音功能依赖 HTTPS 页面和 Android `RECORD_AUDIO` 权限；首次录音时系统会弹出授权提示。
- 不要把 `AI_API_KEY`、SMTP 密码或科大讯飞密钥写入这个壳工程；这些密钥必须继续留在 Sealos 服务端环境变量中。
- 更换线上域名时，只需修改 `pages/index/index.vue` 中的 `appUrl`。
- 如要提交应用市场，还需要补充隐私政策、权限用途、应用图标/启动图和正式签名证书。
