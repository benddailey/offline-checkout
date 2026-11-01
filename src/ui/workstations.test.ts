import { describe, expect, it } from "vite-plus/test";
import type { SessionSummary } from "../store/db";
import { otherWorkstations } from "./workstations";

const summary = (
  sessionId: string,
  workstations?: SessionSummary["workstations"],
): SessionSummary => ({ sessionId, name: sessionId, employee: "Ann", createdAt: 0, workstations });

describe("otherWorkstations", () => {
  it("is empty when no other workstation has a stored name", () => {
    expect(otherWorkstations([summary("a"), summary("b", [])], "me")).toEqual([]);
  });

  it("leaves out this workstation and keeps each device's latest record across sessions", () => {
    const list = otherWorkstations(
      [
        summary("Morning", [
          { deviceId: "me", name: "Mine", lastAt: 9000 },
          { deviceId: "x", name: "Old name", lastAt: 1000 },
          { deviceId: "y", name: "Desk 2", lastAt: 3000 },
        ]),
        summary("Evening", [{ deviceId: "x", name: "Desk 1", lastAt: 5000 }]),
      ],
      "me",
    );
    expect(list).toEqual([
      { deviceId: "x", name: "Desk 1", lastAt: 5000, sessionName: "Evening" },
      { deviceId: "y", name: "Desk 2", lastAt: 3000, sessionName: "Morning" },
    ]);
  });
});
