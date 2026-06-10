/**
 * Rule catalog — thin projection over abaplint's own rule metadata, so the
 * documentation an agent reads is the analyzer's, not a copy that can drift.
 */
import * as abaplint from "@abaplint/core";

import { notFound } from "../errors.js";

export interface RuleSummary {
  key: string;
  title: string;
  shortDescription: string;
  tags: string[];
  docsUrl: string;
}

export interface RuleDetail extends RuleSummary {
  extendedInformation: string;
}

interface RuleMetadata {
  key: string;
  title: string;
  shortDescription: string;
  extendedInformation?: string;
  tags?: string[];
  badExample?: string;
  goodExample?: string;
}

function metadata(): RuleMetadata[] {
  return abaplint.ArtifactsRules.getRules().map((r) => r.getMetadata() as RuleMetadata);
}

function toSummary(m: RuleMetadata): RuleSummary {
  return {
    key: m.key,
    title: m.title,
    shortDescription: m.shortDescription,
    tags: m.tags ?? [],
    docsUrl: `https://rules.abaplint.org/${m.key}/`,
  };
}

export function listRules(query?: string, tag?: string): RuleSummary[] {
  const q = query?.toLowerCase();
  return metadata()
    .filter((m) => {
      if (tag !== undefined && !(m.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()))
        return false;
      if (q !== undefined) {
        const hay = `${m.key} ${m.title} ${m.shortDescription}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .map(toSummary)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function explainRule(key: string): RuleDetail & { badExample?: string; goodExample?: string } {
  const m = metadata().find((x) => x.key === key.toLowerCase());
  if (m === undefined) {
    throw notFound(`No abaplint rule named "${key}". Use list_abap_rules to browse valid keys.`, {
      key,
    });
  }
  const detail: RuleDetail & { badExample?: string; goodExample?: string } = {
    ...toSummary(m),
    extendedInformation: m.extendedInformation ?? "",
  };
  if (m.badExample !== undefined) detail.badExample = m.badExample;
  if (m.goodExample !== undefined) detail.goodExample = m.goodExample;
  return detail;
}
