// 官网前端：渲染插件中心、下载/复制安装命令、提交反馈
const $ = (s) => document.querySelector(s);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function loadPlugins() {
  try {
    const list = await (await fetch('./plugins.json')).json();
    const wrap = $('#pluginCards');
    wrap.innerHTML = '';
    list.forEach((pl) => {
      const card = document.createElement('div');
      card.className = 'card plugin-card';
      const cmd = `node bin/omni.js plugin add ${pl.download}`;
      card.innerHTML = `
        <div class="pc-head"><span class="pc-name">${esc(pl.name)}</span><span class="pc-ver">v${esc(pl.version || '1.0')}</span></div>
        <div class="pc-desc">${esc(pl.description || '')}</div>
        <div class="pc-tools">${(pl.tools || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <div class="pc-actions">
          <a class="btn primary small" href="${esc(pl.download)}" download>下载 .js</a>
          <button class="btn ghost small" data-cmd="${esc(cmd)}">复制安装命令</button>
        </div>
        <div class="pc-copy">${esc(cmd)}</div>`;
      wrap.appendChild(card);
    });
    $$('.pc-actions [data-cmd]', wrap).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.cmd)));
  } catch (e) {
    $('#pluginCards').innerHTML = '<div class="muted">插件列表加载失败。</div>';
  }
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('已复制：' + t); }
  catch { toast('复制失败，请手动复制'); }
}

$('#feedbackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.name.value, email: f.email.value,
    type: f.type.value, message: f.message.value,
  };
  $('#fbHint').textContent = '提交中…';
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('status ' + r.status);
    $('#fbHint').textContent = '';
    toast('感谢反馈，已收到 ✓');
    f.reset();
  } catch (err) {
    $('#fbHint').textContent = '提交失败：' + err.message + '（请确认站点服务在运行）';
  }
});

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function $$(s, r = document) { return [...r.querySelectorAll(s)]; }

loadPlugins();
