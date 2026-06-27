import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    backendUrl: {
        type: OptionType.STRING,
        description: "BetterSearch backend base URL",
        default: "http://localhost:8787",
    },
    apiToken: {
        type: OptionType.STRING,
        description: "Shared API token (BS_API_TOKEN from the backend .env)",
        default: "",
    },
    liveIngest: {
        type: OptionType.BOOLEAN,
        description: "Ingest new messages in allowlisted channels as they arrive",
        default: true,
    },
    ingestMedia: {
        type: OptionType.BOOLEAN,
        description: "Send attachments (images, PDFs, docs) for text extraction",
        default: true,
    },
    allowlist: {
        type: OptionType.STRING,
        description:
            "Comma-separated channel & guild IDs to ingest. Managed by /bettersearch allow, but editable here.",
        default: "",
    },
});
