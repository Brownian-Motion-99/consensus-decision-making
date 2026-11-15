// 預覽總覽頁的共用邏輯：手機版（preview.html）和電腦版（preview-desktop.html）只差在裝置尺寸。

import { PREVIEWS, FLOW_KEY } from '/preview.js';

/**
 * @param {object} opts
 * @param {{ label: string, width: number, height: number }[]} opts.devices
 * @param {number} opts.defaultDevice devices 的預設索引
 * @param {number[]} opts.scales 可選的縮放比例
 * @param {number} opts.defaultScale
 * @param {string} opts.storagePrefix 記住選擇用的 localStorage 前綴，手機版和電腦版分開
 */
export function initGallery({ devices, defaultDevice, scales, defaultScale, storagePrefix }) {
  const grid = document.getElementById('grid');
  const deviceSelect = document.getElementById('device');
  const scaleSelect = document.getElementById('scale');
  const roleSelect = document.getElementById('role');

  devices.forEach((d, i) => deviceSelect.append(new Option(`${d.label}（${d.width} × ${d.height}）`, String(i))));
  scales.forEach((s) => scaleSelect.append(new Option(`${Math.round(s * 100)}%`, String(s))));
  deviceSelect.value = String(defaultDevice);
  scaleSelect.value = String(defaultScale);

  const selects = { device: deviceSelect, scale: scaleSelect, role: roleSelect };

  // 記住上次的選擇，重新整理後不用再選
  for (const [name, select] of Object.entries(selects)) {
    try {
      const saved = localStorage.getItem(`${storagePrefix}-${name}`);
      if (saved !== null && [...select.options].some((o) => o.value === saved)) select.value = saved;
    } catch {}
    select.addEventListener('change', () => {
      try {
        localStorage.setItem(`${storagePrefix}-${name}`, select.value);
      } catch {}
      build();
    });
  }

  function entries() {
    const list = [{ key: FLOW_KEY, label: '劇本模式（← → 切換，可看動畫和音效）', roles: ['host', 'guest'] }];
    for (const [key, preview] of Object.entries(PREVIEWS)) list.push({ key, ...preview });
    return list;
  }

  function frame(entry, role, device, scale) {
    const url = `/?preview=${encodeURIComponent(entry.key)}${role ? `&as=${role}` : ''}`;
    const figure = document.createElement('figure');

    const caption = document.createElement('figcaption');
    const title = document.createElement('span');
    title.textContent = role ? `${entry.label}｜${role === 'host' ? '主持人' : '一般玩家'}` : entry.label;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.textContent = '另開';
    caption.append(title, link);

    // iframe 用原尺寸渲染，再用 transform 縮小，版面才會和真的螢幕一樣
    const viewport = document.createElement('div');
    viewport.className = 'frame';
    viewport.style.width = `${device.width * scale}px`;
    viewport.style.height = `${device.height * scale}px`;
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.width = device.width;
    iframe.height = device.height;
    iframe.loading = 'lazy';
    iframe.title = title.textContent;
    iframe.style.transform = `scale(${scale})`;
    viewport.append(iframe);

    figure.append(caption, viewport);
    return figure;
  }

  function build() {
    const device = devices[Number(deviceSelect.value)];
    const scale = Number(scaleSelect.value);
    const roleFilter = roleSelect.value;
    const frames = [];
    for (const entry of entries()) {
      for (const role of entry.roles ?? [null]) {
        if (role && roleFilter !== 'all' && role !== roleFilter) continue;
        frames.push(frame(entry, role, device, scale));
      }
    }
    grid.replaceChildren(...frames);
  }

  build();
}
