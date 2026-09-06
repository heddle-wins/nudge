import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "Nudge",
  version: "0.2.0",
  description: "Privacy-first browser automation by Heddle.",
  permissions: ["activeTab", "tabs", "sidePanel", "scripting"],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ],
  side_panel: {
    default_path: "src/sidepanel/index.html"
  },
  action: {
    default_title: "Open Nudge"
  }
};

export default manifest;
