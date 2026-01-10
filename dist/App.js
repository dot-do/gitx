import { jsx as _jsx } from "react/jsx-runtime";
/**
 * App dashboard component for gitx.do
 *
 * Repository browser dashboard using @mdxui/cockpit:
 * - Repository listing and management
 * - Commit history viewer
 * - Branch and tag management
 * - File tree browser
 * - Diff viewer
 * - Clone/push/pull actions
 */
import { DeveloperDashboard } from '@mdxui/cockpit';
const config = {
    branding: {
        name: 'gitx.do',
        logo: _jsx("span", { className: "font-bold", children: "gitx.do" }),
    },
    identity: {
        clientId: 'gitx',
        devMode: process.env.NODE_ENV === 'development',
    },
    routes: {
        overview: true,
        requests: false,
        keys: true,
        team: false,
        billing: false,
        settings: true,
        webhooks: true,
        database: false,
        vault: false,
    },
};
export default function App() {
    return _jsx(DeveloperDashboard, { config: config });
}
//# sourceMappingURL=App.js.map