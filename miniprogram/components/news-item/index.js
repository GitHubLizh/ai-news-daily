Component({
  properties: {
    item: { type: Object, value: {} },
    read: { type: Boolean, value: false },
    saved: { type: Boolean, value: false },
  },
  methods: {
    onOpen() {
      const { id, url, title, source } = this.data.item;
      this.triggerEvent('open', { id, url, title, source });
    },
    onSave() {
      this.triggerEvent('save', { id: this.data.item.id });
    },
    onRead() {
      this.triggerEvent('read', { id: this.data.item.id });
    },
    onCopy() {
      this.triggerEvent('copy', { id: this.data.item.id, url: this.data.item.url });
    },
  },
});
