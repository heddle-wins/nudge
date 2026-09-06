import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "Nudge",
  version: "0.3.0",
  description: "Privacy-first browser automation by Heddle.",
  permissions: ["activeTab", "tabs", "sidePanel", "scripting", "storage"],
  host_permissions: ["<all_urls>"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: http: https:"
  },
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
