import type { OutputFormat } from "../types";
import { CopyIcon, EditIcon, TrashIcon } from "./Icons";

type Props = {
  formats: OutputFormat[];
  selectedIds: Set<string>;
  disabled?: boolean;
  onToggle: (id: string) => void;
  onEdit: (format: OutputFormat) => void;
  onDuplicate: (format: OutputFormat) => void;
  onDelete: (format: OutputFormat) => void;
};

function byteLabel(bytes: number) {
  return `${Math.round(bytes / 1024)} КБ`;
}

export function FormatCatalog({
  formats,
  selectedIds,
  disabled,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const groups = Object.entries(
    formats.reduce<Record<string, OutputFormat[]>>((result, format) => {
      (result[format.group] ??= []).push(format);
      return result;
    }, {}),
  );

  return (
    <div className="format-groups">
      {groups.map(([group, groupFormats]) => (
        <section className="format-group" key={group} aria-labelledby={`group-${group}`}>
          <div className="format-group__heading">
            <h3 id={`group-${group}`}>{group}</h3>
            <span>{groupFormats.length}</span>
          </div>
          <div className="format-grid">
            {groupFormats.map((format) => {
              const checked = selectedIds.has(format.id);
              return (
                <article
                  className={`format-card ${checked ? "format-card--selected" : ""}`}
                  key={format.id}
                >
                  <label className="format-card__select">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(format.id)}
                    />
                    <span className="checkmark" aria-hidden="true" />
                    <span className="format-card__content">
                      <strong>{format.name}</strong>
                      <span className="format-card__meta">
                        {format.width} × {format.height} · {format.extension.toUpperCase()} · до{" "}
                        {byteLabel(format.maxBytes)}
                      </span>
                      {format.prompt && (
                        <span className="format-card__prompt">{format.prompt}</span>
                      )}
                    </span>
                  </label>
                  <div className="format-card__actions">
                    <button
                      type="button"
                      onClick={() => onDuplicate(format)}
                      title="Дублировать"
                      aria-label={`Дублировать формат ${format.name}`}
                    >
                      <CopyIcon />
                    </button>
                    {!format.builtIn && (
                      <>
                        <button
                          type="button"
                          onClick={() => onEdit(format)}
                          title="Редактировать"
                          aria-label={`Редактировать формат ${format.name}`}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(format)}
                          title="Удалить"
                          aria-label={`Удалить формат ${format.name}`}
                        >
                          <TrashIcon />
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
