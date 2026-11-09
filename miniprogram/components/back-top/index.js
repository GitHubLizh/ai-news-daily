Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    onTap() {
      wx.pageScrollTo({ scrollTop: 0, duration: 300 });
    },
  },
});
