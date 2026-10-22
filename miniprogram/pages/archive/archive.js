/* 归档页：年 / 月 / 日三级日历（对照 web 版 renderCalendar） */

import { todayKey } from '../../utils/time.js';

const app = getApp();
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

Page({
  data: {
    ready: false,
    mode: 'day', // day | month | year
    year: 0,
    month: 1,
    headLabel: '',
    canPrev: false,
    canNext: false,
    weekdays: WEEKDAYS,
    years: [],
    months: [],
    cells: [],
  },

  unsubscribe: null,

  onLoad() {
    this.unsubscribe = app.onDataset(({ data }) => {
      if (!data) return;
      if (!this.data.year) {
        const latest = (data.days && data.days[0] && data.days[0].day) || todayKey();
        const [year, month] = latest.split('-').map(Number);
        this.setData({ year, month });
      }
      this.setData({ ready: true });
      this.render();
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  daysMap() {
    const data = app.globalData.data;
    const map = new Map();
    for (const entry of (data && data.days) || []) map.set(entry.day, entry.count);
    return map;
  },

  render() {
    const data = app.globalData.data;
    if (!data || !data.days || !data.days.length) return;
    const days = data.days;
    const earliest = days[days.length - 1].day;
    const latest = days[0].day;
    const [eYear, eMonth] = earliest.split('-').map(Number);
    const [lYear, lMonth] = latest.split('-').map(Number);

    if (this.data.mode === 'year') {
      const years = [...new Set(days.map((entry) => Number(entry.day.slice(0, 4))))].sort((a, b) => b - a);
      this.setData({
        headLabel: '选择年份',
        years: years.map((year) => ({
          year,
          count: days
            .filter((entry) => entry.day.startsWith(`${year}-`))
            .reduce((acc, entry) => acc + entry.count, 0),
        })),
      });
      return;
    }

    if (this.data.mode === 'month') {
      const year = this.data.year;
      this.setData({
        headLabel: `${year} 年`,
        canPrev: year > eYear,
        canNext: year < lYear,
        months: Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
          const prefix = `${year}-${String(month).padStart(2, '0')}`;
          const count = days
            .filter((entry) => entry.day.startsWith(prefix))
            .reduce((acc, entry) => acc + entry.count, 0);
          const inRange =
            (year > eYear || (year === eYear && month >= eMonth)) &&
            (year < lYear || (year === lYear && month <= lMonth));
          return { month, count, inRange, active: false };
        }),
      });
      return;
    }

    // 日模式
    const { year, month } = this.data;
    const withNews = this.daysMap();
    const canNext = year < lYear || (year === lYear && month < lMonth);
    const canPrev = year > eYear || (year === eYear && month > eMonth);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const startPad = (first.getUTCDay() + 6) % 7; // 周一为一周起点
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const today = todayKey();

    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push({ pad: true, key: `pad-${i}` });
    for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
      cells.push({
        pad: false,
        key,
        label: dayOfMonth,
        count: withNews.get(key) || 0,
        inRange: key >= earliest && key <= latest,
        isToday: key === today,
      });
    }

    this.setData({
      headLabel: `${year} 年 ${month} 月`,
      canPrev,
      canNext,
      cells,
    });
  },

  onModeTap(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
    this.render();
  },

  onStep(event) {
    const delta = Number(event.currentTarget.dataset.step);
    if (this.data.mode === 'day') {
      const date = new Date(Date.UTC(this.data.year, this.data.month - 1 + delta, 1));
      this.setData({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
    } else if (this.data.mode === 'month') {
      this.setData({ year: this.data.year + delta });
    }
    this.render();
  },

  onYearTap(event) {
    this.setData({ mode: 'month', year: Number(event.currentTarget.dataset.year) });
    this.render();
  },

  onMonthTap(event) {
    if (!event.currentTarget.dataset.enabled) return;
    this.setData({ mode: 'day', month: Number(event.currentTarget.dataset.month) });
    this.render();
  },

  onDayTap(event) {
    const { day, enabled } = event.currentTarget.dataset;
    if (!enabled) return;
    app.globalData.pendingDay = day;
    wx.switchTab({ url: '/pages/latest/latest' });
  },
});
