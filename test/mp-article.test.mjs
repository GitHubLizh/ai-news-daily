import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { htmlToArticle } from '../cloudfunctions/article/extract.mjs';

const URL = 'https://example.com/news/2026/10/13/article-1';

describe('htmlToArticle 正文提取', () => {
  it('从噪声中选出正文容器', () => {
    const html = `<!doctype html><html><head><title>某大模型发布 - 示例科技</title></head><body>
      <nav><a href="/">首页</a><a href="/list">资讯</a><a href="/about">关于我们</a></nav>
      <div class="sidebar"><a href="/x">相关推荐文章一</a><a href="/y">相关推荐文章二</a></div>
      <article class="content">
        <p>某公司今天正式发布了新一代大模型，参数量相比上一代翻了一倍，官方称推理成本下降明显。</p>
        <p>发布会上演示了代码生成与多轮对话能力，现场响应速度肉眼可见地快了不少。</p>
        <p>该模型将于下周向开发者开放 API，定价尚未公布。</p>
      </article>
      <footer>版权所有 不得转载</footer>
    </body></html>`;
    const { title, blocks } = htmlToArticle(html, URL);
    assert.equal(title, '某大模型发布 - 示例科技');
    const paragraphs = blocks.filter((block) => block.type === 'p').map((block) => block.text);
    assert.equal(paragraphs.length, 3);
    assert.ok(paragraphs[0].includes('大模型'));
    assert.ok(!blocks.some((block) => (block.text || '').includes('相关推荐')));
  });

  it('懒加载图片取 data-src 并转绝对地址', () => {
    const html = `<html><head><title>t</title></head><body><div class="article">
      <p>第一段内容，长度足够超过十五个字的门槛，用来凑数。</p>
      <p>第二段内容，长度也足够超过十五个字的门槛，继续凑数。</p>
      <img data-src="/static/pic.png" alt="示意图" />
    </div></body></html>`;
    const { blocks } = htmlToArticle(html, URL);
    const img = blocks.find((block) => block.type === 'img');
    assert.equal(img.src, 'https://example.com/static/pic.png');
    assert.equal(img.alt, '示意图');
  });

  it('文本实体被解码', () => {
    const html = `<html><head><title>A &amp; B</title></head><body><article>
      <p>Tom &amp; Jerry 是一对经典搭档，这句话的长度足够被保留下来。</p>
      <p>第二段也足够长，&#8220;引号&#8221;与&nbsp;空格都应该被正确处理掉。</p>
    </article></body></html>`;
    const { title, blocks } = htmlToArticle(html, URL);
    assert.equal(title, 'A & B');
    assert.ok(blocks[0].text.includes('Tom & Jerry'));
  });

  it('短碎屑段落被丢弃', () => {
    const html = `<html><body><article>
      <p>编辑：张三</p>
      <p>这是真正有内容的第一段，长度超过十五个字，应该被保留下来。</p>
      <p>这是真正有内容的第二段，长度同样超过十五个字，也应该被保留。</p>
    </article></body></html>`;
    const { blocks } = htmlToArticle(html, URL);
    assert.deepEqual(
      blocks.map((block) => block.text),
      ['这是真正有内容的第一段，长度超过十五个字，应该被保留下来。', '这是真正有内容的第二段，长度同样超过十五个字，也应该被保留。'],
    );
  });

  it('正文太少时返回空 blocks（小程序端据此回退复制链接）', () => {
    const html = '<html><head><title>空页</title></head><body><div>什么都没有</div></body></html>';
    const { blocks } = htmlToArticle(html, URL);
    assert.deepEqual(blocks, []);
  });

  it('未闭合标签容错', () => {
    const html = `<html><body><div class="content">
      <p>第一段没有闭合的段落标签，内容足够长所以会被保留下来
      <p>第二段同样没有闭合，提取器不应该因此崩溃或丢内容
    </div></body></html>`;
    const { blocks } = htmlToArticle(html, URL);
    assert.ok(blocks.filter((block) => block.type === 'p').length >= 1);
  });

  it('广告容器被跳过（不误伤 read/load 等类名）', () => {
    const html = `<html><body><article>
      <p>正文第一段，长度超过十五个字的门槛，应该被保留下来。</p>
      <div class="ad-banner"><p>视听双绝沉浸全场，广告词再长也不算正文。</p></div>
      <p class="read-more">正文第二段，长度同样超过十五个字，应该被保留。</p>
    </article></body></html>`;
    const { blocks } = htmlToArticle(html, URL);
    const texts = blocks.map((block) => block.text || '');
    assert.ok(!texts.some((text) => text.includes('视听双绝')));
    assert.ok(texts.some((text) => text.includes('正文第二段')));
  });

  it('面包屑与转载声明被过滤', () => {
    const html = `<html><body><article>
      <p>当前位置：首页 &gt; 资讯中心 &gt; 科技业界 &gt; 文章详情</p>
      <p>这是正文第一段，长度超过十五个字的门槛，应该保留。</p>
      <p>这是正文第二段，长度同样超过十五个字的门槛，也保留。</p>
      <p>转载请注明来源，未经授权一律不得转载，违者必究到底。</p>
    </article></body></html>`;
    const { blocks } = htmlToArticle(html, URL);
    const texts = blocks.map((block) => block.text || '');
    assert.deepEqual(texts, ['这是正文第一段，长度超过十五个字的门槛，应该保留。', '这是正文第二段，长度同样超过十五个字的门槛，也保留。']);
  });

  it('占位图与加载图被跳过', () => {
    const html = `<html><body><article>
      <p>第一段内容，长度超过十五个字的门槛，应该被保留下来。</p>
      <p>第二段内容，长度也超过十五个字的门槛，应该被保留下来。</p>
      <img src="/assets/loading.gif" />
      <img src="https://icons.example.com/common/icon_warning.png" />
      <img src="https://cdn.example.com/real-photo.jpg" />
    </article></body></html>`;
    const { blocks } = htmlToArticle(html, URL);
    const images = blocks.filter((block) => block.type === 'img');
    assert.deepEqual(images.map((block) => block.src), ['https://cdn.example.com/real-photo.jpg']);
  });
});
