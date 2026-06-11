/**
 * @pattern/mod-identity — admin screens (Tier-1 declarative, zero build).
 *
 * Users / Invite / Sessions under an "Access" category. Tables use the
 * per-row actions added to the Tier-1 contract this round; everything goes
 * through the admin invoke endpoint, which is admin-stamped when identity is
 * installed — plus the ops re-check scopes themselves.
 */

import type { FrontendContribution } from "@pattern/core";

export function identityFrontend(): FrontendContribution {
  return {
    menu: [
      { category: "Access", label: "Users", icon: "users", path: "/x/identity/users", order: 10 },
      { category: "Access", label: "Invite", icon: "user-plus", path: "/x/identity/invite", order: 20 },
      { category: "Access", label: "Sessions", icon: "key-round", path: "/x/identity/sessions", order: 30 },
    ],
    pages: [
      {
        path: "/x/identity/users",
        view: {
          kind: "table",
          source: "identity.users.list",
          columns: [
            { key: "email", label: "Email" },
            { key: "name", label: "Name" },
            { key: "roles", label: "Roles" },
            { key: "disabled", label: "Disabled", format: "badge" },
            { key: "created", label: "Created", format: "date" },
          ],
          rowActions: [
            { label: "Toggle disabled", run: "identity.users.toggleDisabled", args: { userId: "id" }, icon: "ban", confirm: true },
            { label: "Log out everywhere", run: "identity.users.revokeSessions", args: { userId: "id" }, icon: "log-out", confirm: true },
          ],
        },
      },
      {
        path: "/x/identity/invite",
        view: {
          kind: "form",
          schema: {
            type: "object",
            properties: {
              email: { type: "string", description: "Who to invite" },
              roles: { type: "string", description: 'Comma-separated roles, e.g. "admin" (empty = plain user)' },
            },
            required: ["email"],
          },
          submit: "identity.users.invite",
        },
      },
      {
        path: "/x/identity/sessions",
        view: {
          kind: "table",
          source: "identity.sessions.list",
          columns: [
            { key: "user", label: "User" },
            { key: "status", label: "Status", format: "badge" },
            { key: "created", label: "Created", format: "date" },
            { key: "lastSeen", label: "Last seen", format: "date" },
            { key: "userAgent", label: "Device" },
          ],
          rowActions: [
            { label: "Revoke", run: "identity.sessions.revoke", args: { sessionId: "id" }, icon: "log-out", confirm: true },
          ],
        },
      },
    ],
    commands: [
      { id: "identity.invite", label: "Invite user…", group: "Access", icon: "user-plus", path: "/x/identity/invite" },
      { id: "identity.whoami", label: "Who am I?", group: "Access", icon: "user", run: "identity.whoami" },
    ],
  };
}
