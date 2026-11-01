import { describe, expect, it } from "vite-plus/test";
import type { SessionSummary } from "../store/db";
import { otherWorkstations } from "./workstations";

const summary = (
  sessionId: string,
  workstations?: SessionSummary["workstations"],
): SessionSummary => ({ sessionId, name: sessionId, employee: "Ann", createdAt: 0, workstations });

describe("otherWorkstations", () => {
  it("is empty when no other workstation has a stored name", () => {
    expect(otherWorkstations([summary("a"), summary("b", [])], 0)).toEqual([]);
  });

  it("keeps each device's latest record across sessions and leaves out older ones", () => {
    const list = otherWorkstations(
      [
        summary("Morning", [
          { deviceId: "old", name: "Retired", lastAt: 1500 },
          { deviceId: "x", name: "Old name", lastAt: 2500 },
          { deviceId: "y", name: "Desk 2", lastAt: 3000 },
        ]),
        summary("Evening", [{ deviceId: "x", name: "Desk 1", lastAt: 5000 }]),
      ],
      2000,
    );
    expect(list).toEqual([
      { deviceId: "x", name: "Desk 1", lastAt: 5000, sessionName: "Evening" },
      { deviceId: "y", name: "Desk 2", lastAt: 3000, sessionName: "Morning" },
    ]);
  });
});
