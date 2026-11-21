import "./style.css";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AppState,
  DeskIcon,
  DeskSnapshot,
  IconType,
  SysNotif,
  Task,
  Theme,
  WidgetBox,
  Zone,
} from "./types";

/* ================= 常量 ================= */
/** 浏览器里预览（vite dev 直接开）时没有 Tauri 后端，所有 invoke 都 reject */
const IN_TAURI = "__TAURI_INTERNALS__" in window;
function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IN_TAURI) return Promise.reject(new Error("no-tauri"));
  return tauriInvoke<T>(cmd, args);
}

const EM: Record<IconType, string> = {
  folder: "📁",
  doc: "📝",
  sheet: "📊",
  pdf: "📕",
  ppt: "📙",
  img: "🖼",
  media: "🎵",
  zip: "🗜",
  app: "💻",
  lnk: "🔗",
  other: "📄",
};

const TYPE_ORDER: IconType[] = [
  "folder",
  "doc",
  "sheet",
  "pdf",
  "ppt",
  "img",
  "media",
  "zip",
  "app",
  "lnk",
  "other",
];

const EXT2T: Record<string, IconType> = {
  folder: "folder",
  doc: "doc",
  docx: "doc",
  wps: "doc",
  txt: "doc",
  md: "doc",
  rtf: "doc",
  xls: "sheet",
  xlsx: "sheet",
  et: "sheet",
  csv: "sheet",
  pdf: "pdf",
  ppt: "ppt",
  pptx: "ppt",
  png: "img",
  jpg: "img",
  jpeg: "img",
  gif: "img",
  webp: "img",
  bmp: "img",
  psd: "img",
  mp3: "media",
  wav: "media",
  m4a: "media",
  mp4: "media",
  flv: "media",
  zip: "zip",
  rar: "zip",
  "7z": "zip",
  exe: "app",
  msi: "app",
  lnk: "lnk",
  url: "lnk",
};

/* 桌面上的系统图标不是真实文件，扫目录扫不到，只能按名字认 */
const SYS_ICONS = ["此电脑", "回收站", "网络", "控制面板", "用户文件夹", "Administrator"];
function isSysIcon(name: string) {
  return SYS_ICONS.some((s) => name === s || name.startsWith(s + "（") || name.startsWith(s + "("));
}

const DEFAULT_ZONES = (): Zone[] => [
  { id: "z1", name: "工作", x: 0, y: 0, w: 0.5, h: 1 },
  { id: "z2", name: "临时", x: 0.5, y: 0, w: 0.5, h: 0.5 },
  { id: "z3", name: "应用", x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
];

const DEFAULT_WIDGETS = (): WidgetBox[] => [
  { id: "clock", left: -1, top: -1, w: 0, h: 172, visible: true },
  { id: "tasks", left: -1, top: -1, w: 0, h: 340, visible: true },
  { id: "cd", left: -1, top: -1, w: 0, h: 240, visible: true },
  { id: "remind", left: -1, top: -1, w: 0, h: 236, visible: true },
  { id: "theme", left: -1, top: -1, w: 0, h: 420, visible: false },
];

const DEFAULT_THEME: Theme = {
  accent: "#5b9cff",
  opacity: 62,
  blur: 26,
  radius: 22,
  preset: "雾蓝",
};

const ACCENTS = ["#5b9cff", "#a78bfa", "#38c98a", "#ff9a4a", "#ff6b8a", "#3fc6d4"];
const PRESETS = [
  { n: "雾蓝", a: "#5b9cff", bg: "linear-gradient(150deg,#dfeaff,#c6d9ff)" },
  { n: "藕紫", a: "#a78bfa", bg: "linear-gradient(150deg,#ece2ff,#d8c9ff)" },
  { n: "薄荷", a: "#38c98a", bg: "linear-gradient(150deg,#d6f5e8,#b8ecd8)" },
  { n: "杏桃", a: "#ff9a4a", bg: "linear-gradient(150deg,#ffe8d2,#ffd4b0)" },
];

/* ================= 状态 ================= */
let S: AppState = {
  version: 1,
  theme: { ...DEFAULT_THEME },
  widgets: DEFAULT_WIDGETS(),
  zones: DEFAULT_ZONES(),
  tasks: [],
  icons: [],
};
let editing = false;
let remindAll = false;
/** 提醒组件当前页签：任务 / 系统通知 */
let remindTab: "task" | "sys" = "task";
/** Windows 通知中心拉来的 toast */
let sysNotifs: SysNotif[] = [];
let sysNotifErr = "";
let cellW = 76;
let cellH = 100;

const el = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const root = document.documentElement;
const WD = ["日", "一", "二", "三", "四", "五", "六"];

/* ================= 工具 ================= */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function typeOf(ext: string): IconType {
  return EXT2T[ext] ?? "other";
}
function defaultZoneFor(t: IconType): string {
  if (t === "app" || t === "lnk") return "z3";
  if (t === "folder" || t === "doc" || t === "sheet" || t === "pdf" || t === "ppt") return "z1";
  return "z2";
}

/* 规则 B：有 slot 的按位次插，其余按类型排 */
function buildZoneList(zoneId: string): DeskIcon[] {
  const all = S.icons.filter((d) => d.zone === zoneId);
  const pinned = all.filter((d) => d.slot != null).sort((a, b) => a.slot! - b.slot!);
  const free = all
    .filter((d) => d.slot == null)
    .sort((a, b) => {
      const d0 = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      if (d0) return d0;
      return a.name.localeCompare(b.name, "zh");
    });
  const out: DeskIcon[] = [];
  const used = new Set<string>();
  let fi = 0;
  for (let i = 0; i < all.length; i++) {
    const hit = pinned.find((p) => p.slot === i && !used.has(p.name));
    if (hit) {
      out.push(hit);
      used.add(hit.name);
    } else if (fi < free.length) {
      out.push(free[fi++]);
    }
  }
  pinned.forEach((p) => {
    if (!used.has(p.name)) out.push(p);
  });
  return out;
}

/* ================= 浏览器预览用的假数据 ================= */
function seedPreview() {
  document.body.classList.add("preview");
  const now = Date.now();
  S.tasks = [
    { id: "a", title: "设计稿终稿交付", done: true, due: null, tags: [{ k: "a", t: "设计" }] },
    { id: "b", title: "周报提交", done: false, due: new Date(now + 4 * 3600e3).toISOString(), tags: [] },
    { id: "c", title: "项目复盘会材料", done: false, due: new Date(now + 26 * 3600e3).toISOString(), tags: [{ k: "p", t: "工作" }] },
    { id: "d", title: "回复客户邮件", done: false, due: null, tags: [{ k: "g", t: "沟通" }] },
    { id: "e", title: "整理桌面截图素材", done: false, due: new Date(now + 9 * 3600e3).toISOString(), tags: [] },
  ];
  const demo: [string, string][] = [
    ["此电脑", "app"], ["回收站", "app"], ["SecPortal", "lnk"], ["奔图扫描应用软件 Pantum M7100DN Series", "lnk"],
    ["memreduct - 快捷方式", "lnk"],
    ["村社上报台账", "folder"], ["安江镇烟花爆竹资料", "folder"], ["2026消防隐患大排查", "folder"],
    ["安全生产文档", "folder"], ["应安委发文", "folder"],
    ["安江镇通讯录（2026.5.21）", "sheet"], ["附件_2026年度涉企行政检查计划", "sheet"],
    ["洪江市安江镇2026年度涉企行政检查计划", "sheet"], ["(安江)汇总企业或场所名单统计表(1)", "sheet"],
    ["行政检查台账", "sheet"], ["安江镇隐患汇总表", "doc"], ["2026.3.27领导带队检查情况登记表", "doc"],
    ["安江镇领导带队检查安全生产情况登记表", "doc"], ["《湖南省涉企行政检查标准文书（试行）》", "doc"],
    ["安江镇安全生产工作开展情况", "doc"], ["隐患排查登记表", "doc"], ["资料目录", "doc"],
    ["洪江市安江镇重大事故隐患整治清单", "pdf"], ["4月带队检查", "pdf"], ["（工贸）恒泰纸业重大隐患", "pdf"],
    ["2026行政检查审批表", "pdf"], ["2026安江镇消防救援应急工作方案", "pdf"], ["荷风商业广场", "pdf"],
    ["网上报名服务平台", "pdf"], ["2026年检查照片", "doc"], ["新建 DOCX 文档", "doc"],
  ];
  S.icons = demo.map(([name, ext]) => {
    const t = ext === "app" || ext === "lnk" ? (ext as IconType) : (ext as IconType);
    return { name, ext, type: t, emoji: EM[t], zone: defaultZoneFor(t), slot: null, x: 0, y: 0 };
  });
}

/* ================= 数据加载 ================= */
async function loadState() {
  try {
    const raw = await invoke<string | null>("state_load");
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      S = { ...S, ...parsed };
      if (!S.zones?.length) S.zones = DEFAULT_ZONES();
      if (!S.widgets?.length) S.widgets = DEFAULT_WIDGETS();
      if (!S.tasks) S.tasks = [];
      if (!S.icons) S.icons = [];
    }
  } catch {
    /* 首次运行没有状态文件 */
  }
}

async function loadDesk() {
  try {
    const snap = await invoke<DeskSnapshot>("desk_read");
    if (!snap.ok) {
      console.warn("读桌面失败:", snap.error);
      return;
    }
    if (snap.cell_w > 20) cellW = snap.cell_w;
    if (snap.cell_h > 20) cellH = snap.cell_h;
    root.style.setProperty("--cell-w", cellW + "px");
    root.style.setProperty("--cell-h", cellH + "px");

    const files = await invoke<[string, string][]>("desk_files");
    const extOf = new Map<string, string>();
    for (const [stem, ext] of files) {
      if (!extOf.has(stem)) extOf.set(stem, ext);
    }

    const old = new Map(S.icons.map((i) => [i.name, i]));
    S.icons = snap.icons.map((i) => {
      const prev = old.get(i.name);
      let ext = extOf.get(i.name) ?? "";
      if (!ext) {
        const dot = i.name.lastIndexOf(".");
        if (dot > 0) ext = i.name.slice(dot + 1).toLowerCase();
      }
      if (!ext) {
        for (const [stem, e] of extOf) {
          if (i.name.startsWith(stem)) {
            ext = e;
            break;
          }
        }
      }
      const t: IconType = isSysIcon(i.name) ? "app" : ext ? typeOf(ext) : "other";
      // 类型变了（比如上次把文件夹误判成 other）就重新分区，别把错的分区一路带下去
      const zone = prev && prev.type === t ? prev.zone : defaultZoneFor(t);
      return {
        name: i.name,
        ext,
        type: t,
        emoji: EM[t],
        zone,
        slot: prev && prev.type === t ? prev.slot : null,
        x: i.x,
        y: i.y,
      };
    });
  } catch (e) {
    console.warn("desk_read 调用失败", e);
  }
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    invoke("state_save", { json: JSON.stringify(S) }).catch(() => {});
  }, 300);
}

/* ================= 主题 ================= */
function applyTheme() {
  root.style.setProperty("--accent", S.theme.accent);
  root.style.setProperty("--a-widget", (S.theme.opacity / 100).toFixed(2));
  root.style.setProperty("--blur", S.theme.blur + "px");
  root.style.setProperty("--radius", S.theme.radius + "px");
}

/* ================= 图标区渲染 ================= */
function areaRect() {
  return el("#iconArea").getBoundingClientRect();
}

function renderZones() {
  const area = el("#iconArea");
  area.innerHTML = "";
  for (const z of S.zones) {
    const d = document.createElement("div");
    d.className = "zone";
    d.dataset.id = z.id;
    d.style.left = `calc(${z.x * 100}% + 6px)`;
    d.style.top = `calc(${z.y * 100}% + 6px)`;
    d.style.width = `calc(${z.w * 100}% - 12px)`;
    d.style.height = `calc(${z.h * 100}% - 12px)`;
    d.innerHTML = `
      <div class="zone-head">
        <span class="zone-name">${z.name}</span>
        <span class="zone-cnt"></span>
        <button class="zone-del" title="删除分区">✕</button>
      </div>
      <div class="zone-grid"></div>
      <div class="zrz"></div>`;
    area.appendChild(d);
  }
  renderIcons();
}

function renderIcons() {
  const area = el("#iconArea");
  const ar = area.getBoundingClientRect();
  for (const z of S.zones) {
    const box = area.querySelector(`.zone[data-id="${z.id}"]`) as HTMLElement | null;
    if (!box) continue;
    const list = buildZoneList(z.id);
    const headH = 22;
    const zw = z.w * ar.width - 12 - 20;
    const zh = z.h * ar.height - 12 - headH - 12;
    const cols = Math.max(1, Math.floor(zw / cellW));
    const rows = Math.max(1, Math.floor(zh / cellH));
    const grid = box.querySelector(".zone-grid") as HTMLElement;

    if (!editing && IN_TAURI) {
      grid.innerHTML = "";
      continue;
    }
    grid.innerHTML = list
      .map((d, i) => {
        const col = Math.floor(i / rows);
        const row = i % rows;
        return `<div class="dico ${d.slot != null ? "pin" : ""}"
          data-n="${d.name.replace(/"/g, "&quot;")}"
          style="left:${col * cellW}px;top:${row * cellH}px">
          <span class="em">${d.emoji}</span>
          <span class="nm">${d.name}</span>
        </div>`;
      })
      .join("");
    (box.querySelector(".zone-cnt") as HTMLElement).textContent = `${list.length} 个${
      list.length > cols * rows ? " · 放不下" : ""
    }`;
    if (list.length > cols * rows) box.classList.add("overflow");
    else box.classList.remove("overflow");
  }
  el("#ebN").textContent = `${S.icons.length} 个 · ${S.zones.length} 区`;
}

/* ================= 拖动图标（整理模式） ================= */
let press: { ico: HTMLElement; x: number; y: number } | null = null;
let ghost: HTMLElement | null = null;
let dragEl: HTMLElement | null = null;

el("#iconArea").addEventListener("pointerdown", (ev) => {
  const e = ev as PointerEvent;
  const ico = (e.target as HTMLElement).closest(".dico") as HTMLElement | null;
  if (!ico || !editing) return;
  press = { ico, x: e.clientX, y: e.clientY };
  e.preventDefault();
});

document.addEventListener("pointermove", (ev) => {
  const e = ev as PointerEvent;
  if (press && !ghost) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) startDrag(press.ico, e);
    else return;
  }
  if (!ghost) return;
  ghost.style.left = e.clientX - cellW / 2 + "px";
  ghost.style.top = e.clientY - cellH / 2 + "px";
});

function startDrag(ico: HTMLElement, e: PointerEvent) {
  const r = ico.getBoundingClientRect();
  ghost = ico.cloneNode(true) as HTMLElement;
  ghost.className = "ghost-drag dico";
  ghost.style.width = r.width + "px";
  ghost.style.height = r.height + "px";
  ghost.style.left = e.clientX - r.width / 2 + "px";
  ghost.style.top = e.clientY - r.height / 2 + "px";
  document.body.appendChild(ghost);
  ico.classList.add("holding");
  dragEl = ico;
  press = null;
}

document.addEventListener("pointerup", (ev) => {
  const e = ev as PointerEvent;
  press = null;
  if (!ghost) return;
  ghost.remove();
  ghost = null;
  if (dragEl) dragEl.classList.remove("holding");
  const name = dragEl?.dataset.n;
  dragEl = null;
  if (!name) return;

  const rec = S.icons.find((d) => d.name === name);
  const zoneEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
    ".zone",
  ) as HTMLElement | null;
  if (!rec || !zoneEl) return;
  const to = zoneEl.dataset.id!;

  const tiles = [...zoneEl.querySelectorAll(".dico")].filter((t) => (t as HTMLElement).dataset.n !== name);
  let idx = tiles.length;
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      idx = i;
      break;
    }
    if (e.clientY < r.bottom && e.clientX < r.left + r.width / 2) {
      idx = i;
      break;
    }
  }
  const list = buildZoneList(to).filter((d) => d.name !== name);
  list.splice(idx, 0, rec);
  rec.zone = to;
  list.forEach((d, i) => {
    if (d.name === name) d.slot = i;
  });
  renderIcons();
  save();
});

/* ================= 分区拖动 / 缩放 ================= */
let zact: {
  type: "move" | "resize";
  z: Zone;
  ar: DOMRect;
  sx: number;
  sy: number;
  x0: number;
  y0: number;
  w0: number;
  h0: number;
} | null = null;

el("#iconArea").addEventListener("pointerdown", (ev) => {
  const e = ev as PointerEvent;
  if (!editing) return;
  const tgt = e.target as HTMLElement;

  const del = tgt.closest(".zone-del");
  if (del) {
    const id = (del.closest(".zone") as HTMLElement).dataset.id!;
    if (S.zones.length > 1) {
      S.zones = S.zones.filter((z) => z.id !== id);
      S.icons.forEach((d) => {
        if (d.zone === id) {
          d.zone = S.zones[0].id;
          d.slot = null;
        }
      });
      renderZones();
      save();
    }
    return;
  }

  const zoneEl = tgt.closest(".zone") as HTMLElement | null;
  if (!zoneEl) return;
  const z = S.zones.find((x) => x.id === zoneEl.dataset.id)!;
  const ar = areaRect();
  if (tgt.closest(".zrz")) {
    zact = { type: "resize", z, ar, sx: e.clientX, sy: e.clientY, x0: z.x, y0: z.y, w0: z.w, h0: z.h };
  } else if (tgt.closest(".zone-head")) {
    zact = { type: "move", z, ar, sx: e.clientX, sy: e.clientY, x0: z.x, y0: z.y, w0: z.w, h0: z.h };
    zoneEl.style.zIndex = "20";
  } else return;
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener("pointermove", (ev) => {
  const e = ev as PointerEvent;
  if (!zact) return;
  const dx = (e.clientX - zact.sx) / zact.ar.width;
  const dy = (e.clientY - zact.sy) / zact.ar.height;
  const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  if (zact.type === "move") {
    zact.z.x = cl(zact.x0 + dx, 0, 1 - zact.z.w);
    zact.z.y = cl(zact.y0 + dy, 0, 1 - zact.z.h);
  } else {
    zact.z.w = cl(zact.w0 + dx, 0.12, 1 - zact.z.x);
    zact.z.h = cl(zact.h0 + dy, 0.12, 1 - zact.z.y);
  }
  const box = el(`.zone[data-id="${zact.z.id}"]`) as HTMLElement | null;
  if (box) {
    box.style.left = `calc(${zact.z.x * 100}% + 6px)`;
    box.style.top = `calc(${zact.z.y * 100}% + 6px)`;
    box.style.width = `calc(${zact.z.w * 100}% - 12px)`;
    box.style.height = `calc(${zact.z.h * 100}% - 12px)`;
  }
});

document.addEventListener("pointerup", () => {
  if (zact) {
    const box = el(`.zone[data-id="${zact.z.id}"]`) as HTMLElement | null;
    if (box) box.style.zIndex = "";
    renderIcons();
    save();
  }
  zact = null;
});

/* ================= 应用布局到真实桌面 ================= */
async function applyLayout() {
  const ar = areaRect();
  const positions: [string, number, number][] = [];
  for (const z of S.zones) {
    const list = buildZoneList(z.id);
    const zw = z.w * ar.width - 12 - 20;
    const zh = z.h * ar.height - 12 - 22 - 12;
    const cols = Math.max(1, Math.floor(zw / cellW));
    const rows = Math.max(1, Math.floor(zh / cellH));
    void cols;
    list.forEach((d, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = Math.round(ar.left + z.x * ar.width + 6 + 10 + col * cellW);
      const y = Math.round(ar.top + z.y * ar.height + 6 + 22 + row * cellH);
      positions.push([d.name, x, y]);
    });
  }
  try {
    const n = await invoke<number>("desk_apply", { positions });
    toast(`已摆放 ${n} 个图标`);
  } catch (e) {
    toast(`摆放失败：${e}`);
  }
}

/* ================= 整理模式 ================= */
async function setEditing(on: boolean) {
  editing = on;
  document.body.classList.toggle("editing", on);
  el("#btnEdit").classList.toggle("on", on);
  try {
    await invoke("desk_icons_visible", { visible: !on });
  } catch {
    /* 忽略 */
  }
  if (on) {
    renderZones();
  } else {
    renderIcons();
  }
  pushHitRects();
}

/* ================= 组件拖动 / 缩放 ================= */
/** 让某个组件按内容高度自动撑开（「查看全部」展开时用） */
function autoSizeWidget(id: string, baseH: number) {
  const wb = S.widgets.find((w) => w.id === id);
  const box = el(`#wg-${id}`) as HTMLElement | null;
  if (!wb || !box) return;
  const body = box.querySelector(".wg-body") as HTMLElement | null;
  const head = box.querySelector(".wg-head") as HTMLElement | null;
  const foot = box.querySelector(".rm-f") as HTMLElement | null;
  const extra = (head?.offsetHeight ?? 0) + (foot?.offsetHeight ?? 0) + 24;
  const need = (body?.scrollHeight ?? 0) + extra;
  const want = Math.max(baseH, need);
  if (wb.h === want) return;
  wb.h = want;
  box.style.height = wb.h + "px";
  save();
  pushHitRects();
}

function applyWidgetBoxes() {
  const vw = window.innerWidth;
  const pad = 40;
  const lw = Math.min(264, Math.max(216, vw * 0.15));
  const defaults: Record<string, { left: number; top: number; w: number }> = {
    clock: { left: pad, top: pad, w: lw },
    tasks: { left: pad, top: pad + 192, w: lw },
    cd: { left: vw - pad - lw, top: pad, w: lw },
    remind: { left: vw - pad - lw, top: pad + 260, w: lw },
    theme: { left: vw - pad - lw, top: pad + 516, w: lw },
  };
  for (const wb of S.widgets) {
    const box = el(`#wg-${wb.id}`) as HTMLElement | null;
    if (!box) continue;
    const d = defaults[wb.id];
    if (wb.left < 0 || wb.top < 0) {
      wb.left = d.left;
      wb.top = d.top;
    }
    if (!wb.w) wb.w = d.w;
    box.style.left = wb.left + "px";
    box.style.top = wb.top + "px";
    box.style.width = wb.w + "px";
    box.style.height = wb.h + "px";
    box.style.display = wb.visible || (wb.id === "theme" && box.classList.contains("on")) ? "flex" : "none";
  }
}

let wact: {
  type: "drag" | "resize";
  wb: WidgetBox;
  box: HTMLElement;
  sx: number;
  sy: number;
  l0: number;
  t0: number;
  w0: number;
  h0: number;
} | null = null;

document.querySelectorAll(".wg").forEach((node) => {
  const box = node as HTMLElement;
  const id = box.id.replace("wg-", "");
  const rz = box.querySelector(".rz");
  if (rz) {
    rz.addEventListener("pointerdown", (ev) => {
      const e = ev as PointerEvent;
      const wb = S.widgets.find((x) => x.id === id);
      if (!wb) return;
      const r = box.getBoundingClientRect();
      wb.left = r.left;
      wb.top = r.top;
      wact = { type: "resize", wb, box, sx: e.clientX, sy: e.clientY, l0: r.left, t0: r.top, w0: r.width, h0: r.height };
      hitFull = true;
      pushHitRects();
      e.stopPropagation();
      e.preventDefault();
    });
  }
  box.addEventListener("pointerdown", (ev) => {
    const e = ev as PointerEvent;
    if ((e.target as HTMLElement).closest("button, input, .rz, .tk, .sw, .dot")) return;
    const wb = S.widgets.find((x) => x.id === id);
    if (!wb) return;
    const r = box.getBoundingClientRect();
    wb.left = r.left;
    wb.top = r.top;
    box.classList.add("dragging");
    wact = { type: "drag", wb, box, sx: e.clientX, sy: e.clientY, l0: r.left, t0: r.top, w0: r.width, h0: r.height };
    hitFull = true;
    pushHitRects();
    e.preventDefault();
  });
});

document.addEventListener("pointermove", (ev) => {
  const e = ev as PointerEvent;
  if (!wact) return;
  const dx = e.clientX - wact.sx;
  const dy = e.clientY - wact.sy;
  if (wact.type === "drag") {
    wact.wb.left = Math.max(-20, wact.l0 + dx);
    wact.wb.top = Math.max(-20, wact.t0 + dy);
  } else {
    wact.wb.w = Math.max(180, wact.w0 + dx);
    wact.wb.h = Math.max(90, wact.h0 + dy);
  }
  wact.box.style.left = wact.wb.left + "px";
  wact.box.style.top = wact.wb.top + "px";
  wact.box.style.width = wact.wb.w + "px";
  wact.box.style.height = wact.wb.h + "px";
});

document.addEventListener("pointerup", () => {
  if (wact) {
    wact.box.classList.remove("dragging");
    hitFull = false;
    save();
    pushHitRects();
  }
  wact = null;
});

// 拖动中若丢了 pointerup（切窗口、Esc 打断），窗口区域会一直停在整屏，
// 那样整个桌面都点不动 —— 兜底复位。
document.addEventListener("pointercancel", () => {
  if (wact) {
    wact.box.classList.remove("dragging");
    save();
  }
  wact = null;
  if (hitFull) {
    hitFull = false;
    pushHitRects();
  }
});
window.addEventListener("blur", () => {
  if (hitFull && !wact) {
    hitFull = false;
    pushHitRects();
  }
});

/* ================= 命中区域同步（窗口只在组件上吃鼠标） ================= */
let hitTimer = 0;
// 拖动/缩放期间窗口区域临时放大到整屏，否则组件一移出原来的矩形就被裁掉。
let hitFull = false;
function pushHitRects() {
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => {
    const dpr = window.devicePixelRatio || 1;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    if (hitFull) {
      rects.push({ x: 0, y: 0, w: window.innerWidth * dpr, h: window.innerHeight * dpr });
      invoke("hit_set", { rects }).catch(() => {});
      return;
    }
    document.querySelectorAll(".wg").forEach((n) => {
      const box = n as HTMLElement;
      if (box.style.display === "none" || box.offsetParent === null) return;
      const r = box.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      rects.push({ x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr });
    });
    // 用触发区而不是 dock 本身：dock 收起时缩得很小，命中区得一直够大才够得着
    const dock = el(".dock-zone").getBoundingClientRect();
    rects.push({ x: dock.left * dpr, y: dock.top * dpr, w: dock.width * dpr, h: dock.height * dpr });
    const eb = el(".editbar");
    if (document.body.classList.contains("editing")) {
      const r = eb.getBoundingClientRect();
      rects.push({ x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr });
      const ar = areaRect();
      rects.push({ x: ar.left * dpr, y: ar.top * dpr, w: ar.width * dpr, h: ar.height * dpr });
    }
    const sheet = el(".sheet");
    if (sheet.classList.contains("on")) {
      const r = sheet.getBoundingClientRect();
      rects.push({ x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr });
    }
    invoke("hit_set", { rects }).catch(() => {});
  }, 60);
}

/* ================= 时钟 ================= */function tick() {
  const d = new Date();
  el("#clkH").textContent = String(d.getHours()).padStart(2, "0");
  el("#clkM").textContent = String(d.getMinutes()).padStart(2, "0");
  el("#clkS").textContent = String(d.getSeconds()).padStart(2, "0");
  el("#clkDate").textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WD[d.getDay()]}`;
  const h = d.getHours();
  el("#clkHi").textContent =
    h < 6 ? "凌晨了" : h < 11 ? "上午好" : h < 13 ? "中午好" : h < 18 ? "下午好" : h < 23 ? "晚上好" : "夜深了";
}

/* ================= 任务 ================= */
function taskTag(t: Task): { cls: string; text: string }[] {
  const out: { cls: string; text: string }[] = [];
  for (const g of t.tags) out.push({ cls: g.k, text: g.t });
  if (t.due) {
    const ms = new Date(t.due).getTime() - Date.now();
    if (ms < 0) out.push({ cls: "r", text: "已逾期" });
    else if (ms < 24 * 3600e3) out.push({ cls: "o", text: "今天截止" });
    else if (ms < 48 * 3600e3) out.push({ cls: "o", text: "明天截止" });
  }
  if (!t.due) out.push({ cls: "", text: "无截止" });
  return out;
}

function renderTasks() {
  const list = el("#taskList");
  if (!S.tasks.length) {
    list.innerHTML = `<div class="empty">还没有任务，点 dock 的 ＋ 加一条</div>`;
  } else {
    list.innerHTML = S.tasks
      .map(
        (x, i) => `<div class="tk ${x.done ? "done" : ""}" data-i="${i}">
        <div class="ck">✓</div>
        <div class="tk-b">
          <div class="tk-t">${x.title}</div>
          <div class="tk-m">${taskTag(x).map((g) => `<span class="tag ${g.cls}">${g.text}</span>`).join("")}</div>
        </div>
        <button class="tk-del" data-del="${i}" title="删除">✕</button>
      </div>`,
      )
      .join("");
  }
  el("#tkN").textContent = `${S.tasks.filter((t) => t.done).length} / ${S.tasks.length}`;
  renderCountdown();
  renderRemind();
}

function fmtLeft(ms: number) {
  if (ms <= 0) return "已逾期";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function renderCountdown() {
  const now = Date.now();
  const due = S.tasks
    .filter((t) => !t.done && t.due)
    .map((t) => ({ t, ms: new Date(t.due!).getTime() - now }))
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 3);
  el("#cdN").textContent = `${due.length} 项`;
  const box = el("#cdList");
  if (!due.length) {
    box.innerHTML = `<div class="empty">暂无截止任务</div>`;
    return;
  }
  box.innerHTML = due
    .map(({ t, ms }) => {
      const hot = ms < 6 * 3600e3;
      const pct = Math.max(4, Math.min(100, 100 - (ms / (72 * 3600e3)) * 100));
      const d = new Date(t.due!);
      const sub = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes(),
      ).padStart(2, "0")}`;
      return `<div class="cd">
        <div class="cd-top">
          <div class="cd-t">${t.title}</div>
          <div class="cd-v ${hot ? "hot" : ""}">${fmtLeft(ms)}</div>
        </div>
        <div class="cd-bar"><div class="cd-fill ${hot ? "hot" : ""}" style="width:${pct}%"></div></div>
        <div class="cd-sub">${sub}</div>
      </div>`;
    })
    .join("");
}

function fmtWhen(ts: number) {
  if (!ts) return "";
  const now = Date.now();
  const d = now - ts;
  if (d < 60e3) return "刚刚";
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
  if (d < 24 * 3600e3) return `${Math.floor(d / 3600e3)} 小时前`;
  const t = new Date(ts);
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  const hh = String(t.getHours()).padStart(2, "0");
  const mi = String(t.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 拉一次 Windows 通知中心（只有真机有后端） */
async function loadSysNotifs() {
  if (!IN_TAURI) {
    sysNotifErr = "浏览器预览里读不到系统通知";
    return;
  }
  try {
    sysNotifs = await invoke<SysNotif[]>("sys_notifs");
    sysNotifErr = "";
  } catch (e) {
    sysNotifs = [];
    const msg = String(e);
    sysNotifErr = msg.includes("denied") ? "没有通知访问权限" : "读取失败：" + msg;
  }
}

function renderRemind() {
  const box = el("#remindList");
  const seg = el("#remindSeg");
  seg.querySelectorAll<HTMLElement>(".seg-i").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === remindTab);
  });

  if (remindTab === "sys") {
    el("#btnSnooze").style.display = "none";
    el("#btnClearAll").style.display = sysNotifs.length ? "" : "none";
    el("#btnAllRemind").textContent = "刷新";
    const all = sysNotifs;
    if (!all.length) {
      box.innerHTML = `<div class="empty">${sysNotifErr || "通知中心里还没有通知"}</div>`;
      el("#remindN").textContent = `通知 0 条`;
      return;
    }
    const shown = all;
    box.innerHTML = shown
      .map(
        (n) => `<div class="rm">
        <div class="rm-app">${n.app || "未知"}</div>
        <div class="rm-tx"><div class="t">${n.title || "(无标题)"}</div>${
          n.body ? `<div class="s">${n.body}</div>` : ""
        }</div>
        <div class="rm-v">${fmtWhen(n.time)}</div>
        <button class="rm-x" data-nid="${n.id}" title="清除这条">✕</button>
      </div>`,
      )
      .join("");
    el("#remindN").textContent = `通知 ${all.length} 条`;
    autoSizeWidget("remind", 236);
    return;
  }

  el("#btnSnooze").style.display = "";
  el("#btnClearAll").style.display = "none";
  const now = Date.now();
  const near = S.tasks
    .filter((t) => !t.done && t.due)
    .map((t) => ({ t, ms: new Date(t.due!).getTime() - now }))
    .filter((x) => x.ms < 48 * 3600e3)
    .sort((a, b) => a.ms - b.ms);
  if (!near.length) {
    box.innerHTML = `<div class="empty">48 小时内没有到期的</div>`;
    el("#remindN").textContent = `今天 0 条`;
    el("#btnAllRemind").textContent = remindAll ? "收起" : "查看全部";
    return;
  }
  const shown = remindAll ? near : near.slice(0, 3);
  box.innerHTML = shown
    .map(
      ({ t, ms }) => `<div class="rm ${ms < 6 * 3600e3 ? "hot" : ""}">
      <div class="rm-v">${fmtLeft(ms)}</div>
      <div class="rm-n">${t.title}</div>
    </div>`,
    )
    .join("");
  el("#remindN").textContent = `今天 ${near.length} 条`;
  el("#btnAllRemind").textContent = remindAll ? "收起" : "查看全部";
}

/* ================= 外观面板 ================= */
function renderThemePanel() {
  el("#presets").innerHTML = PRESETS.map(
    (p, i) => `<button class="sw ${p.a === S.theme.accent ? "on" : ""}" data-i="${i}" style="background:${p.bg}"><span>${p.n}</span></button>`,
  ).join("");
  el("#accentDots").innerHTML = ACCENTS.map(
    (c) => `<button class="dot ${c === S.theme.accent ? "on" : ""}" data-c="${c}" style="background:${c}"></button>`,
  ).join("");
  (el("#rA") as HTMLInputElement).value = String(S.theme.opacity);
  (el("#rB") as HTMLInputElement).value = String(S.theme.blur);
  (el("#rR") as HTMLInputElement).value = String(S.theme.radius);
  el("#vA").textContent = S.theme.opacity + "%";
  el("#vB").textContent = String(S.theme.blur);
  el("#vR").textContent = String(S.theme.radius);
  const tg = el("#tAuto") as HTMLElement;
  const note = el("#autoNote");
  const paint = (on: boolean) => {
    tg.classList.toggle("on", on);
    tg.setAttribute("aria-checked", on ? "true" : "false");
    note.textContent = on ? "开机后自动铺在桌面上" : "开机不会自动启动";
  };
  paint(tg.classList.contains("on"));
  invoke<boolean>("autostart_get")
    .then((on) => paint(!!on))
    .catch(() => {});
  tg.onclick = async () => {
    const want = !tg.classList.contains("on");
    paint(want);
    try {
      const ok = await invoke<boolean>("autostart_set", { on: want });
      if (!ok) {
        paint(!want);
        toast("设置失败，可能被安全软件拦了");
      } else {
        toast(want ? "已设为开机自启" : "已关闭开机自启");
      }
    } catch {
      paint(!want);
      toast("设置失败");
    }
  };

  const bkBtn = el("#btnBk") as HTMLElement;
  const bkN = el("#bkN");
  invoke<{ count: number; dir: string; latest: string | null }>("backup_status")
    .then((b) => {
      bkN.textContent = b.count + " 份";
    })
    .catch(() => {
      bkN.textContent = "—";
    });
  bkBtn.onclick = () => {
    invoke<boolean>("backup_open")
      .then((ok) => {
        if (!ok) toast("打不开备份文件夹");
      })
      .catch(() => toast("打不开备份文件夹"));
  };

  el("#presets")
    .querySelectorAll(".sw")
    .forEach((b) =>
      b.addEventListener("click", () => {
        const p = PRESETS[+(b as HTMLElement).dataset.i!];
        S.theme.accent = p.a;
        S.theme.preset = p.n;
        applyTheme();
        renderThemePanel();
        save();
      }),
    );
  el("#accentDots")
    .querySelectorAll(".dot")
    .forEach((b) =>
      b.addEventListener("click", () => {
        S.theme.accent = (b as HTMLElement).dataset.c!;
        S.theme.preset = "";
        applyTheme();
        renderThemePanel();
        save();
      }),
    );
  bindRange("#rA", (v) => {
    S.theme.opacity = v;
    el("#vA").textContent = v + "%";
  });
  bindRange("#rB", (v) => {
    S.theme.blur = v;
    el("#vB").textContent = String(v);
  });
  bindRange("#rR", (v) => {
    S.theme.radius = v;
    el("#vR").textContent = String(v);
  });
}

function bindRange(sel: string, fn: (v: number) => void) {
  const r = el(sel) as HTMLInputElement;
  r.addEventListener("input", () => {
    fn(+r.value);
    applyTheme();
    save();
  });
}

/* ================= 提示条 ================= */
let toastTimer = 0;
function toast(msg: string) {
  let t = el("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), 1800);
}

/* ================= dock / 交互绑定 ================= */
function bindUI() {
  el("#taskList").addEventListener("click", (ev) => {
    const tgt = ev.target as HTMLElement;
    const del = tgt.closest(".tk-del") as HTMLElement | null;
    if (del) {
      const i = +del.dataset.del!;
      const t = S.tasks[i];
      if (t) {
        S.tasks.splice(i, 1);
        renderTasks();
        save();
      }
      return;
    }
    const row = tgt.closest(".tk") as HTMLElement | null;
    if (!row) return;
    const i = +row.dataset.i!;
    S.tasks[i].done = !S.tasks[i].done;
    renderTasks();
    save();
  });

  el("#btnNew").addEventListener("click", () => {
    el(".sheet").classList.add("on");
    (el("#fTitle") as HTMLInputElement).value = "";
    (el("#fDue") as HTMLInputElement).value = "";
    // 要打字，临时允许抢焦点，否则输入框收不到键盘
    invoke("focus_set", { on: true }).catch(() => {});
    setTimeout(() => (el("#fTitle") as HTMLInputElement).focus(), 60);
    pushHitRects();
  });
  el("#fCancel").addEventListener("click", () => {
    el(".sheet").classList.remove("on");
    invoke("focus_set", { on: false }).catch(() => {});
    pushHitRects();
  });
  el("#fOk").addEventListener("click", () => {
    const title = (el("#fTitle") as HTMLInputElement).value.trim();
    if (!title) return;
    const dueRaw = (el("#fDue") as HTMLInputElement).value;
    S.tasks.unshift({
      id: uid(),
      title,
      done: false,
      due: dueRaw ? new Date(dueRaw).toISOString() : null,
      tags: [],
    });
    el(".sheet").classList.remove("on");
    invoke("focus_set", { on: false }).catch(() => {});
    renderTasks();
    save();
    pushHitRects();
  });

  el("#btnEdit").addEventListener("click", () => setEditing(!editing));
  el("#btnCancel").addEventListener("click", () => setEditing(false));
  el("#btnApply").addEventListener("click", async () => {
    await applyLayout();
    await setEditing(false);
  });
  el("#btnAutoSort").addEventListener("click", () => {
    S.icons.forEach((d) => {
      d.slot = null;
      d.zone = defaultZoneFor(d.type);
    });
    renderZones();
    save();
    toast("已按类型重排");
  });
  el("#btnReset").addEventListener("click", () => {
    S.zones = DEFAULT_ZONES();
    S.icons.forEach((d) => {
      d.zone = defaultZoneFor(d.type);
      d.slot = null;
    });
    renderZones();
    save();
    toast("已恢复默认分区");
  });
  el("#btnAddZone").addEventListener("click", () => {
    S.zones.push({ id: "z" + uid(), name: "新分区", x: 0.06, y: 0.28, w: 0.3, h: 0.42 });
    renderZones();
    save();
  });
  el("#btnSnap").addEventListener("click", async () => {
    try {
      const n = await invoke<number>("snapshot_save");
      toast(`已存快照 ${n} 个`);
    } catch (e) {
      toast(`失败：${e}`);
    }
  });
  el("#btnRestore").addEventListener("click", async () => {
    try {
      const n = await invoke<number>("snapshot_restore");
      toast(`已还原 ${n} 个`);
      await loadDesk();
      renderIcons();
    } catch (e) {
      toast(`失败：${e}`);
    }
  });

  el("#btnTheme").addEventListener("click", () => {
    const box = el("#wg-theme");
    const on = box.classList.toggle("on");
    const wb = S.widgets.find((w) => w.id === "theme");
    if (wb) {
      wb.visible = on;
      box.style.display = on ? "flex" : "none";
    }
    el("#btnTheme").classList.toggle("on", on);
    if (on) renderThemePanel();
    save();
    pushHitRects();
  });
  el("#themeClose").addEventListener("click", () => {
    el("#wg-theme").classList.remove("on");
    el("#wg-theme").style.display = "none";
    el("#btnTheme").classList.remove("on");
    const wb = S.widgets.find((w) => w.id === "theme");
    if (wb) wb.visible = false;
    save();
    pushHitRects();
  });

  el("#btnQuit").addEventListener("click", () => invoke("app_quit"));
  el("#btnReload").addEventListener("click", async () => {
    await loadDesk();
    renderZones();
    toast("已重新读取桌面");
  });

  el("#btnAllRemind").addEventListener("click", async () => {
    if (remindTab === "sys") {
      await loadSysNotifs();
      renderRemind();
      toast("已刷新系统通知");
      return;
    }
    remindAll = !remindAll;
    renderRemind();
    autoSizeWidget("remind", 236);
  });
  el("#btnClearAll").addEventListener("click", async () => {
    try {
      await invoke("sys_notif_clear");
      sysNotifs = [];
      renderRemind();
      toast("已清空通知中心");
    } catch (e) {
      toast("清空失败：" + String(e));
    }
  });
  el("#remindList").addEventListener("click", async (e) => {
    const x = (e.target as HTMLElement).closest<HTMLElement>(".rm-x");
    if (!x) return;
    const nid = Number(x.dataset.nid);
    if (!nid) return;
    try {
      await invoke("sys_notif_remove", { id: nid });
      sysNotifs = sysNotifs.filter((n) => n.id !== nid);
      renderRemind();
      autoSizeWidget("remind", 236);
    } catch (err) {
      toast("清除失败：" + String(err));
    }
  });
  el("#remindSeg").addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".seg-i");
    if (!b) return;
    const tab = b.dataset.tab as "task" | "sys";
    if (tab === remindTab) return;
    remindTab = tab;
    remindAll = false;
    if (tab === "sys") await loadSysNotifs();
    renderRemind();
    autoSizeWidget("remind", 236);
  });
  el("#btnSnooze").addEventListener("click", () => {
    const t = dueTaskNow();
    if (!t) return toast("现在没有要提醒的");
    S.snoozed = S.snoozed || {};
    S.snoozed[t.id] = Date.now() + SNOOZE_MS;
    save();
    toast(`「${t.title}」${SNOOZE_MS / 60000} 分钟后再提醒`);
    checkRemind();
  });

  window.addEventListener("resize", () => {
    applyWidgetBoxes();
    renderIcons();
    pushHitRects();
  });
}

/* ================= deadline 悬浮提醒条 ================= */
/** 提前多久开始提醒（毫秒）：到点前 30 分钟、以及逾期后一直提醒 */
const LEAD_MS = 30 * 60 * 1000;
/** 「稍后」推迟多久 */
const SNOOZE_MS = 15 * 60 * 1000;
let remindedSpawned = false;

function dueTaskNow(): Task | null {
  const now = Date.now();
  const cands = S.tasks
    .filter((t) => !t.done && t.due)
    .map((t) => ({ t, ms: new Date(t.due!).getTime() - now }))
    .filter(({ t, ms }) => {
      if (ms > LEAD_MS) return false;
      const snoozeUntil = S.snoozed?.[t.id] ?? 0;
      return now >= snoozeUntil;
    })
    .sort((a, b) => a.ms - b.ms);
  return cands.length ? cands[0].t : null;
}

async function checkRemind() {
  const t = dueTaskNow();
  if (!t) {
    if (remindedSpawned) {
      remindedSpawned = false;
      invoke("remind_hide").catch(() => {});
    }
    return;
  }
  const ms = new Date(t.due!).getTime() - Date.now();
  const hot = ms < 60 * 60 * 1000;
  const sub =
    ms <= 0
      ? `已逾期 ${fmtLeft(-ms)}`
      : ms < 60 * 60 * 1000
        ? `还有 ${Math.max(1, Math.round(ms / 60000))} 分钟截止`
        : `还有 ${fmtLeft(ms)} 截止`;
  try {
    if (!remindedSpawned) {
      await invoke("remind_spawn");
      remindedSpawned = true;
    }
    await invoke("remind_show", { title: t.title, sub, id: t.id, hot });
  } catch {
    /* 浏览器预览里没有这个窗口 */
  }
}

/* 提醒条小窗自己的逻辑（index.html?remind=1） */
async function bootRemind() {
  document.body.classList.add("remind");
  document.body.classList.remove("preview");
  const bar = el("#rbar");
  const show = (p: { title: string; sub: string; hot: boolean; id?: string }) => {
    el("#rbarT").textContent = p.title;
    el("#rbarS").textContent = p.sub;
    bar.classList.toggle("hot", !!p.hot);
    if (p.id) bar.dataset.id = p.id;
  };
  try {
    const p = await invoke<{ title: string; sub: string; hot: boolean; id: string } | null>("remind_payload");
    if (p) show(p);
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ title: string; sub: string; hot: boolean; id: string }>("remind-update", (e) =>
      show(e.payload),
    );
  } catch {
    show({ title: "预览：任务标题", sub: "还有 10 分钟截止", hot: true });
  }

  const close = () => invoke("remind_hide").catch(() => {});
  el("#rClose").addEventListener("click", close);
  el("#rDone").addEventListener("click", () => {
    const id = el("#rbar").dataset.id;
    if (id) invoke("state_done", { id }).catch(() => {});
    close();
    setTimeout(() => location.reload(), 400);
  });
  el("#rLater").addEventListener("click", () => {
    const id = el("#rbar").dataset.id;
    if (id) invoke("state_snooze", { id, untilMs: Date.now() + SNOOZE_MS }).catch(() => {});
    close();
  });
}

/* ================= 启动 ================= */
async function boot() {
  const q0 = new URLSearchParams(location.search);
  if (q0.get("remind") === "1") {
    await bootRemind();
    return;
  }
  await loadState();
  await loadDesk();
  if (!IN_TAURI && !S.icons.length) seedPreview();
  applyTheme();
  applyWidgetBoxes();
  renderZones();
  renderTasks();
  renderThemePanel();
  bindUI();
  tick();
  setInterval(tick, 1000);
  setInterval(renderTasks, 30000);
  pushHitRects();
  setTimeout(pushHitRects, 500);
  checkRemind();
  setInterval(checkRemind, 20000);
  loadSysNotifs().then(() => {
    if (remindTab === "sys") renderRemind();
  });
  setInterval(() => {
    loadSysNotifs().then(() => {
      if (remindTab === "sys") renderRemind();
    });
  }, 60000);

  // 预览用：?edit=1 直接进整理模式，?theme=1 打开外观
  const q = new URLSearchParams(location.search);
  if (q.get("edit") === "1") setEditing(true);
  if (q.get("theme") === "1") el("#btnTheme").click();
}

boot();
