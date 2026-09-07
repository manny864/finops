"use client";

import React, { useState } from "react";
import { X, AlertCircle } from "lucide-react";

interface Receiver {
  type: string;
  value: string;
}

interface ActionGroupConfig {
  id?: string;
  name: string;
  description: string;
  resourceGroup: string;
  region: string;
  enabled: boolean;
  receivers?: Receiver[];
}

interface ActionGroupEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionGroup: ActionGroupConfig | null;
  onSave: (actionGroup: ActionGroupConfig) => Promise<void>;
  loading?: boolean;
}

export default function ActionGroupEditModal({
  isOpen,
  onClose,
  actionGroup,
  onSave,
  loading = false,
}: ActionGroupEditModalProps) {
  const [formData, setFormData] = useState<ActionGroupConfig>(
    actionGroup || {
      name: "",
      description: "",
      resourceGroup: "",
      region: "",
      enabled: true,
      receivers: [],
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

  const addReceiver = () => {
    setFormData((prev) => ({
      ...prev,
      receivers: [...(prev.receivers || []), { type: "email", value: "" }],
    }));
  };

  const updateReceiver = (index: number, field: "type" | "value", value: string) => {
    setFormData((prev) => ({
      ...prev,
      receivers: prev.receivers?.map((r, i) => (i === index ? { ...r, [field]: value } : r)) || [],
    }));
  };

  const removeReceiver = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      receivers: prev.receivers?.filter((_, i) => i !== index) || [],
    }));
  };

  const handleSave = async () => {
    setError(null);
    if (!formData.name.trim()) {
      setError("Action group name is required");
      return;
    }
    if (!formData.description.trim()) {
      setError("Description is required");
      return;
    }
    try {
      await onSave(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving action group");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg bg-white dark:bg-slate-900 shadow-lg max-w-lg w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {actionGroup ? "Edit Action Group" : "Create Action Group"}
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
              Action Group Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="e.g., Production Alerts"
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
              placeholder="Describe this action group"
              rows={2}
              disabled={loading}
            />
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
            <label className="text-sm font-medium text-slate-700">Enable this action group</label>
          </div>

          {/* Receivers */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-slate-900">Receivers</label>
              <button
                onClick={addReceiver}
                className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                disabled={loading}
              >
                + Add Receiver
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {(formData.receivers || []).map((receiver, idx) => (
                <div key={idx} className="flex gap-2">
                  <select
                    value={receiver.type}
                    onChange={(e) => updateReceiver(idx, "type", e.currentTarget.value)}
                    className="flex-shrink-0 rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    disabled={loading}
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="webhook">Webhook</option>
                    <option value="teams">Teams</option>
                  </select>
                  <input
                    type="text"
                    value={receiver.value}
                    onChange={(e) => updateReceiver(idx, "value", e.currentTarget.value)}
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    placeholder="Enter value"
                    disabled={loading}
                  />
                  <button
                    onClick={() => removeReceiver(idx)}
                    className="text-red-600 hover:text-red-700 text-xs font-medium"
                    disabled={loading}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Action Group"}
          </button>
        </div>
      </div>
    </div>
  );
}
