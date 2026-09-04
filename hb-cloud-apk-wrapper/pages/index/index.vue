<template>
  <view class="app-shell">
    <view v-if="permissionState === 'requesting'" class="permission-tip">
      {{ permissionText }}
    </view>
    <view v-else-if="permissionState === 'denied'" class="permission-tip">
      <text>{{ deniedText }}</text>
      <button class="permission-button" @click="requestAudioPermission">{{ retryText }}</button>
    </view>
    <view v-else-if="loadState === 'fallback'" class="fallback-screen">
      <view class="fallback-logo">🌅</view>
      <text class="fallback-title">拾光成长</text>
      <text class="fallback-subtitle">网络暂时不可用，已切换到本机页面</text>
      <button class="fallback-button" @click="retryRemote">重新连接</button>
    </view>
    <web-view
      v-else
      class="app-webview"
      :src="currentUrl"
      allow="microphone; autoplay"
      :webview-styles="webviewStyles"
      :update-title="true"
      @error="handleWebViewError"
    />
  </view>
</template>

<script>
const REMOTE_URL = 'https://shiguangchengzhang-fxaethpl.sealosbja.site/';
const LOCAL_URL = '/hybrid/html/index.html';

export default {
  data() {
    return {
      currentUrl: LOCAL_URL,
      loadState: 'local',
      fallbackTimer: null,
      appUrl: REMOTE_URL,
      permissionState: 'requesting',
      permissionText: '\u6b63\u5728\u7533\u8bf7\u9ea6\u514b\u98ce\u6743\u9650\u2026',
      deniedText: '\u9700\u8981\u9ea6\u514b\u98ce\u6743\u9650\u624d\u80fd\u8fdb\u884c\u53e3\u624d\u8bad\u7ec3\u3002',
      retryText: '\u91cd\u65b0\u6388\u6743',
      webviewStyles: {
        progress: { color: '#4F46E5' }
      }
    };
  },
  onReady() {
    // #ifdef APP-PLUS
    if (typeof plus !== 'undefined') {
      this.syncWebviewInsets();
      this.requestAudioPermission();
    } else {
      this._plusReadyHandler = () => {
        this.syncWebviewInsets();
        this.requestAudioPermission();
      };
      document.addEventListener('plusready', this._plusReadyHandler, { once: true });
    }
    // #endif
    // #ifndef APP-PLUS
    this.permissionState = 'granted';
    // #endif
  },
  onUnload() {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    // #ifdef APP-PLUS
    if (this._plusReadyHandler) document.removeEventListener('plusready', this._plusReadyHandler);
    // #endif
  },
  onBackPress() {
    // #ifdef APP-PLUS
    if (typeof plus !== 'undefined' && plus.webview) {
      try {
        const root = plus.webview.currentWebview();
        const candidates = [];
        if (root && typeof root.children === 'function') candidates.push(...(root.children() || []));
        if (typeof plus.webview.all === 'function') candidates.push(...(plus.webview.all() || []));
        const target = candidates.reverse().find((view) => {
          try {
            const url = typeof view.getURL === 'function' ? view.getURL() : '';
            return url && (url.indexOf('#sg-module-') !== -1 || url.indexOf('#sg-overlay-') !== -1);
          } catch (error) { return false; }
        });
        if (target) {
          if (typeof target.back === 'function') target.back();
          else if (typeof target.evalJS === 'function') target.evalJS('history.back()');
          return true;
        }
      } catch (error) {}
    }
    // #endif
    return false;
  },
  methods: {
    startRemoteFallbackTimer() {
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
      // Do not leave the native WebView looking like a blank white page forever.
      this.fallbackTimer = setTimeout(() => {
        if (this.loadState === 'remote') this.switchToLocal();
      }, 12000);
    },
    switchToLocal() {
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
      this.loadState = 'local';
      this.currentUrl = LOCAL_URL;
    },
    handleWebViewError() {
      this.switchToLocal();
    },
    retryRemote() {
      this.loadState = 'remote';
      this.currentUrl = REMOTE_URL + '?retry=' + Date.now();
    },
    embeddedWebview() {
      if (typeof plus === 'undefined' || !plus.webview) return null;
      try {
        const root = plus.webview.currentWebview();
        const candidates = [];
        if (root && typeof root.children === 'function') candidates.push(...(root.children() || []));
        if (typeof plus.webview.all === 'function') candidates.push(...(plus.webview.all() || []));
        return candidates.reverse().find((view) => {
          try {
            const url = typeof view.getURL === 'function' ? view.getURL() : '';
            return url && !url.startsWith('file://') && !url.startsWith('about:blank');
          } catch (error) { return false; }
        }) || null;
      } catch (error) { return null; }
    },
    syncWebviewInsets() {
      if (typeof plus === 'undefined') return;
      let top = 0, bottom = 0;
      try {
        if (plus.navigator && typeof plus.navigator.getStatusbarHeight === 'function') {
          top = Number(plus.navigator.getStatusbarHeight()) || 0;
        }
        if (plus.navigator && typeof plus.navigator.getSafeAreaInsets === 'function') {
          const insets = plus.navigator.getSafeAreaInsets() || {};
          top = Math.max(top, Number(insets.top) || 0);
          bottom = Math.max(bottom, Number(insets.bottom) || 0);
        }
      } catch (error) {}
      const target = this.embeddedWebview();
      if (!target || typeof target.evalJS !== 'function') return;
      const js = `document.documentElement.classList.add('in-app');document.documentElement.style.setProperty('--sg-native-safe-top','${top}px');document.documentElement.style.setProperty('--sg-native-safe-bottom','${bottom}px');`;
      try { target.evalJS(js); } catch (error) {}
    },
    requestAudioPermission() {
      // #ifdef APP-PLUS
      this.permissionState = 'requesting';
      plus.android.requestPermissions(
        ['android.permission.RECORD_AUDIO'],
        (event) => {
          const granted = event && Array.isArray(event.granted) && event.granted.includes('android.permission.RECORD_AUDIO');
          this.permissionState = granted ? 'granted' : 'denied';
          if (granted) this.$nextTick(() => this.syncWebviewInsets());
        },
        () => { this.permissionState = 'denied'; }
      );
      // #endif
    }
  }
};
</script>

<style>
page,
.app-shell {
  width: 100%;
  height: 100%;
  min-height: 100vh;
  background: #f5f6f8;
}

.app-webview {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  background: #f5f6f8;
}

.permission-tip,
.fallback-screen {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  padding: 120rpx 48rpx;
  color: #1a1d21;
  text-align: center;
  background: #f5f6f8;
}

.fallback-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48rpx; }
.fallback-logo { font-size: 88rpx; margin-bottom: 24rpx; }
.fallback-title { font-size: 40rpx; font-weight: 800; }
.fallback-subtitle { display: block; margin-top: 18rpx; color: #6b7280; font-size: 26rpx; }
.fallback-button,
.permission-button {
  width: 80%;
  margin: 40rpx auto;
  color: #ffffff;
  background: #4f46e5;
  border-radius: 18rpx;
}
</style>


