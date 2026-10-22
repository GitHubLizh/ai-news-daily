/* 阅读页：调用 article 云函数抓取并渲染正文；失败时回退复制链接 */

Page({
  data: {
    loading: true,
    error: '',
    url: '',
    title: '',
    source: '',
    blocks: [],
  },

  onLoad(query) {
    const url = decodeURIComponent(query.url || '');
    const title = decodeURIComponent(query.title || '');
    const source = decodeURIComponent(query.source || '');
    this.setData({ url, title, source });
    if (!url) {
      this.setData({ loading: false, error: '缺少原文链接' });
      return;
    }
    wx.cloud
      .callFunction({ name: 'article', data: { url } })
      .then((response) => {
        const result = (response && response.result) || {};
        if (result.ok) {
          this.setData({
            loading: false,
            title: result.title || title,
            blocks: result.blocks,
          });
        } else {
          this.setData({ loading: false, error: result.message || '正文提取失败' });
        }
      })
      .catch((error) => {
        this.setData({ loading: false, error: `网络错误：${error.message || error}` });
      });
  },

  onCopy() {
    wx.setClipboardData({ data: this.data.url });
  },

  /**
   * 图片直连失败（多为源站防盗链）：走 img 云函数代理重试一次，
   * 代理也失败就把这张图从版面里移除，避免一片裂图占位。
   */
  async onImgError(event) {
    const index = Number(event.currentTarget.dataset.idx);
    const block = this.data.blocks[index];
    if (!block || block.type !== 'img' || block.proxyTried) return;
    this.setData({ [`blocks[${index}].proxyTried`]: true });
    try {
      const response = await wx.cloud.callFunction({
        name: 'img',
        data: { url: block.src, referer: this.data.url },
      });
      const result = (response && response.result) || {};
      if (result.ok) {
        this.setData({ [`blocks[${index}].src`]: `data:${result.contentType};base64,${result.base64}` });
      } else {
        this.setData({ [`blocks[${index}].gone`]: true });
      }
    } catch {
      this.setData({ [`blocks[${index}].gone`]: true });
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.title || 'AI 资讯速递',
      path: `/pages/reader/reader?url=${encodeURIComponent(this.data.url)}&title=${encodeURIComponent(this.data.title)}&source=${encodeURIComponent(this.data.source)}`,
    };
  },
});
