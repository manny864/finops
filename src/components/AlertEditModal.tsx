"use client";

import React, { useState } from "react";
import { X, AlertCircle } from "lucide-react";

interface AlertConfig {
  id?: string;
  name: string;
  description: string;
  resourceGroup: string;
  region: string;
  type: string;
  threshold: number;
  severity: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  notificationChannels?: string[];
}

interface AlertEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: AlertConfig | null;
  onSave: (alert: AlertConfig) => Promise<void>;
  loading?: boolean;
}

export default function AlertEditModal({
  isOpen,
  onClose,
  alert,
  onSave,
  loading = false,
}: AlertEditModalProps) {
  const [formData, setFormData] = useState<AlertConfig>(
    alert || {
      name: "",
      description: "",
      resourceGroup: "",
      region: "",
      type: "",
      threshold: 0,
      severity: "medium",
      enabled: true,
    }
  );
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.currentTarget;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.currentTarget as HTMLInputElement).checked : value,
    }));
  };

  const handleSave = async () => {
    setError(null);
    if (!formData.name.trim()) {
      setError("Alert name is required");
      return;
    }
    if (!formData.description.trim()) {
      setError("Description is required");
      return;
    }
    try {
      await onSave(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving alert");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg bg-white dark:bg-slate-900 shadow-lg max-w-lg w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {alert ? "Edit Alert" : "Create Alert"}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Alert Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="e.g., Budget Threshold Alert"
              disabled={loading}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Description *
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Describe what this alert monitors"
              rows={3}
              disabled={loading}
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Alert Type
            </label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              disabled={loading}
            >
              <option value="">Select type</option>
              <option value="Budget Alert">Budget Alert</option>
              <option value="Performance Alert">Performance Alert</option>
              <option value="Availability Alert">Availability Alert</option>
              <option value="Security Alert">Security Alert</option>
            </select>
          </div>

          {/* Threshold & Severity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Threshold
              </label>
              <input
                type="number"
                name="threshold"
                value={formData.threshold}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="0"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Severity
              </label>
              <select
                name="severity"
                value={formData.severity}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                disabled={loading}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Resource Group & Region */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Resource Group
              </label>
              <input
                type="text"
                name="resourceGroup"
                value={formData.resourceGroup}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="e.g., prod-rg"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Region
              </label>
              <input
                type="text"
                name="region"
                value={formData.region}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="e.g., eastus"
                disabled={loading}
              />
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              name="enabled"
              checked={formData.enabled}
              onChange={handleChange}
              className="rounded border-slate-300"
              disabled={loading}
            />
            <label className="text-sm font-medium text-slate-700">Enable this alert</label>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-6 py-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Alert"}
          </button>
        </div>
      </div>
    </div>
  );
}
