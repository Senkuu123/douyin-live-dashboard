import type { DesktopApi } from "../../contracts.js";

declare global { interface Window { dashboard: DesktopApi } }
export {};
