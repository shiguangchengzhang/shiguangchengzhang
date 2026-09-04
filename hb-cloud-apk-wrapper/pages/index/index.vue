<template>
  <view class="app-shell">
    <view v-if="permissionState === 'requesting'" class="permission-tip">
      {{ permissionText }}
    </view>
    <view v-else-if="permissionState === 'denied'" class="permission-tip">
      <text>{{ deniedText }}</text>
      <button class="permission-button" @click="requestAudioPermission">{{ retryText }}</button>
    </view>
    <web-view
      v-else
      :src="appUrl"
      allow="microphone; autoplay"
      :webview-styles="webviewStyles"
      :update-title="true"
    />
  </view>
</template>

<script>
export default {
  data() {
    return {
      appUrl: 'https://shiguangchengzhang-fxaethpl.sealosbja.site',
      permissionState: 'requesting',
      permissionText: '\u6b63\u5728\u7533\u8bf7\u9ea6\u514b\u98ce\u6743\u9650\u2026',
      deniedText: '\u9700\u8981\u9ea6\u514b\u98ce\u6743\u9650\u624d\u80fd\u8fdb\u884c\u53e3\u624d\u8bad\u7ec3\u3002',
      retryText: '\u91cd\u65b0\u6388\u6743',
      webviewStyles: {
        progress: {
          color: '#8B6F47'
        }
      }
    };
  },
  onReady() {
    // #ifdef APP-PLUS
    if (typeof plus !== 'undefined') {
      this.requestAudioPermission();
    } else {
      this._plusReadyHandler = () => this.requestAudioPermission();
      document.addEventListener('plusready', this._plusReadyHandler, { once: true });
    }
    // #endif
    // #ifndef APP-PLUS
    this.permissionState = 'granted';
    // #endif
  },
  onUnload() {
    // #ifdef APP-PLUS
    if (this._plusReadyHandler) document.removeEventListener('plusready', this._plusReadyHandler);
    // #endif
  },
  methods: {
    requestAudioPermission() {
      // #ifdef APP-PLUS
      this.permissionState = 'requesting';
      plus.android.requestPermissions([
        'android.permission.RECORD_AUDIO',
        'android.permission.MODIFY_AUDIO_SETTINGS'
      ], (result) => {
        const denied = [
          ...(result.deniedAlways || []),
          ...(result.deniedPresent || [])
        ];
        this.permissionState = denied.length ? 'denied' : 'granted';
      }, () => {
        this.permissionState = 'denied';
      });
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
  background: #f8f7f3;
}

.permission-tip {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 120rpx 48rpx;
  color: #5b5145;
  text-align: center;
  background: #f8f7f3;
}

.permission-button {
  width: 80%;
  margin: 40rpx auto;
  color: #ffffff;
  background: #8b6f47;
}
</style>
