import { describe, it, expect } from "vitest";
import { csvEscape, buildCsvHeader, buildCsvRow, buildCsv } from "@/lib/csvExport";

describe("csvExport", () => {
  describe("csvEscape", () => {
    it("should escape commas", () => {
      expect(csvEscape("hello,world")).toBe('"hello,world"');
    });

    it("should escape quotes by doubling", () => {
      expect(csvEscape('hello"world')).toBe('"hello""world"');
    });

    it("should escape newlines", () => {
      expect(csvEscape("hello\nworld")).toBe('"hello\nworld"');
    });

    it("should not escape values without special chars", () => {
      expect(csvEscape("helloworld")).toBe("helloworld");
    });

    it("should handle multiple special chars", () => {
      expect(csvEscape('hello,"world"\ntest')).toBe('"hello,""world""\ntest"');
    });

    it("should handle null/undefined", () => {
      expect(csvEscape(null)).toBe("");
      expect(csvEscape(undefined)).toBe("");
    });

    it("should convert numbers to string", () => {
      expect(csvEscape(123)).toBe("123");
    });
  });

  describe("buildCsvHeader", () => {
    it("should return correct CSV header", () => {
      const header = buildCsvHeader();
      expect(header).toBe("id,timestamp,user_email,action_type,resource_id,status");
    });
  });

  describe("buildCsvRow", () => {
    it("should build CSV row from log object", () => {
      const log = {
        id: 1,
        timestamp: "2024-01-01T12:00:00Z",
        user_email: "test@example.com",
        action_type: "CREATE",
        resource_id: "resource/123",
        status: "SUCCESS",
      };
      const row = buildCsvRow(log);
      expect(row).toBe('1,2024-01-01T12:00:00Z,test@example.com,CREATE,resource/123,SUCCESS');
    });

    it("should escape fields with commas", () => {
      const log = {
        id: 1,
        timestamp: "2024-01-01T12:00:00Z",
        user_email: '"test@example.com"',
        action_type: "CREATE",
        resource_id: "resource/123",
        status: "SUCCESS",
      };
      const row = buildCsvRow(log);
      expect(row).toContain('"test@example.com"');
    });
  });

  describe("buildCsv", () => {
    it("should build complete CSV with header and rows", () => {
      const logs = [
        {
          id: 1,
          timestamp: "2024-01-01T12:00:00Z",
          user_email: "test1@example.com",
          action_type: "CREATE",
          resource_id: "resource/123",
          status: "SUCCESS",
        },
        {
          id: 2,
          timestamp: "2024-01-02T12:00:00Z",
          user_email: "test2@example.com",
          action_type: "DELETE",
          resource_id: "resource/456",
          status: "FAILURE",
        },
      ];
      const csv = buildCsv(logs);
      const lines = csv.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("id,timestamp,user_email,action_type,resource_id,status");
      expect(lines[1]).toContain("test1@example.com");
      expect(lines[2]).toContain("test2@example.com");
    });

    it("should handle empty logs array", () => {
      const csv = buildCsv([]);
      expect(csv).toBe("id,timestamp,user_email,action_type,resource_id,status");
    });
  });
});
