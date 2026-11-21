export type Tag = { k: string; t: string };

export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** ISO 本地时间字符串，null = 无截止 */
  due: string | null;
  tags: Tag[];
}

export interface Zone {
  id: string;
  name: string;
  /** 0–1，相对图标区 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type IconType =
  | "folder"
  | "doc"
  | "sheet"
  | "pdf"
  | "ppt"
  | "img"
  | "media"
  | "zip"
  | "app"
  | "lnk"
  | "other";

export interface DeskIcon {
  name: string;
  ext: string;
  type: IconType;
  emoji: string;
  zone: string | null;
  /** 手动摆放的位次；null = 按类型自动排 */
  slot: number | null;
  /** 桌面上的物理坐标（读到的原值，用于快照对比） */
  x: number;
  y: number;
}

export interface WidgetBox {
  id: string;
  left: number;
  top: number;
  w: number;
  h: number;
  visible: boolean;
}

export interface Theme {
  accent: string;
  opacity: number;
  blur: number;
  radius: number;
  preset: string;
}

export interface AppState {
  version: number;
  theme: Theme;
  widgets: WidgetBox[];
  zones: Zone[];
  tasks: Task[];
  icons: DeskIcon[];
  /** 任务 id -> 稍后提醒到的时间戳（毫秒） */
  snoozed?: Record<string, number>;
  /** 已经弹过提醒的任务 id，避免重复弹 */
  reminded?: string[];
}

/** Windows 通知中心里的一条 toast */
export interface SysNotif {
  id: number;
  app: string;
  aumid: string;
  title: string;
  body: string;
  /** unix 毫秒 */
  time: number;
}

export interface DeskSnapshot {
  icons: { name: string; x: number; y: number }[];
  cell_w: number;
  cell_h: number;
  screen_w: number;
  screen_h: number;
  ok: boolean;
  error: string | null;
}
