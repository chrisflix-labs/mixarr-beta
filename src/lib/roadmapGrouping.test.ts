import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentRoadmapRelease, roadmapReleaseGroups, roadmapReleases } from "./roadmap";

describe("v2.4.4 roadmap organization",()=>{
  it("makes AI-assisted recipe creation the current release",()=>{assert.equal(currentRoadmapRelease()?.version,"2.4.4");assert.equal(currentRoadmapRelease()?.title,"AI-Assisted Recipe Creation");});
  it("retains the broader v2.4.x AI-Assisted Mix Intelligence release line",()=>{const next=roadmapReleases.find((release)=>release.version==="2.4.x");assert.equal(next?.title,"AI-Assisted Mix Intelligence");assert.equal(next?.status,"upcoming");assert.match(next?.description||"",/user-controlled/i);});
  it("preserves every completed release in collapsed group data",()=>{const groups=roadmapReleaseGroups();const completed=groups.completed.flatMap((cycle)=>cycle.releases);assert.ok(completed.some((release)=>release.version==="2.3.8"));assert.equal(new Set(completed.map((release)=>release.version)).size,completed.length);});
});
