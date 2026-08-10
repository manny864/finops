"use client";

import React from "react";

export interface FinopsTableOption {
  value: string;
  label: string;
}

interface FinopsTableControlsProps {
  resourceOptions: FinopsTableOption[];
  regionOptions: FinopsTableOption[];
  typeOptions: FinopsTableOption[];
  resourceGroupOptions: FinopsTableOption[];
  sortOptions: FinopsTableOption[];
  selectedResource: string;
  selectedRegion: string;
  selectedType: string;
  selectedResourceGroup: string;
  selectedSort: string;
  onResourceChange: (value: string) => void;
  onRegionChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onResourceGroupChange: (value: string) => void;
  onSortChange: (value: string) => void;
  labels: {
    resource: string;
    region: string;
    type: string;
    resourceGroup: string;
    sort: string;
  };
}

/**
 * Directiva UI estándar (FinOps tables):
 * filtros por recurso/región/tipo/grupo + orden común para todas las tablas.
 */
export default function FinopsTableControls({
  resourceOptions,
  regionOptions,
  typeOptions,
  resourceGroupOptions,
  sortOptions,
  selectedResource,
  selectedRegion,
  selectedType,
  selectedResourceGroup,
  selectedSort,
  onResourceChange,
  onRegionChange,
  onTypeChange,
  onResourceGroupChange,
  onSortChange,
  labels,
}: FinopsTableControlsProps) {
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <LabeledSelect
          label={labels.resource}
          value={selectedResource}
          onChange={onResourceChange}
          options={resourceOptions}
        />
        <LabeledSelect
          label={labels.region}
          value={selectedRegion}
          onChange={onRegionChange}
          options={regionOptions}
        />
        <LabeledSelect
          label={labels.type}
          value={selectedType}
          onChange={onTypeChange}
          options={typeOptions}
        />
        <LabeledSelect
          label={labels.resourceGroup}
          value={selectedResourceGroup}
          onChange={onResourceGroupChange}
          options={resourceGroupOptions}
        />
        <LabeledSelect
          label={labels.sort}
          value={selectedSort}
          onChange={onSortChange}
          options={sortOptions}
        />
      </div>
    </section>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FinopsTableOption[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
