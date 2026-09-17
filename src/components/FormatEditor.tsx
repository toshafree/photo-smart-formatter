import { useState, type FormEvent } from "react";
import { createFormatId, validateFormat } from "../lib/format";
import type { OutputFormat, OutputMimeType } from "../types";
import { XIcon } from "./Icons";

type Props = {
  initial?: OutputFormat;
  onSave: (format: OutputFormat) => void;
  onClose: () => void;
};

const template = "{sourceBase}__{formatSlug}.{ext}";

export function FormatEditor({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [group, setGroup] = useState(initial?.group ?? "Мои форматы");
  const [width, setWidth] = useState(String(initial?.width ?? 1200));
  const [height, setHeight] = useState(String(initial?.height ?? 800));
  const [mimeType, setMimeType] = useState<OutputMimeType>(initial?.mimeType ?? "image/jpeg");
  const [maxKb, setMaxKb] = useState(String(Math.round((initial?.maxBytes ?? 500 * 1024) / 1024)));
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [filenameTemplate, setFilenameTemplate] = useState(initial?.filenameTemplate ?? template);
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const format: OutputFormat = {
      id: initial?.id ?? createFormatId(name),
      group,
      name,
      width: Number(width),
      height: Number(height),
      mimeType,
      extension: mimeType === "image/jpeg" ? "jpg" : "png",
      maxBytes: Math.round(Number(maxKb) * 1024),
      prompt: prompt.trim() || undefined,
      filenameTemplate,
      builtIn: false,
    };
    const result = validateFormat(format);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Проверьте поля формата.");
      return;
    }
    onSave(result.data);
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="format-editor-title"
      >
        <div className="modal__header">
          <div>
            <p className="eyebrow">Свой пресет</p>
            <h2 id="format-editor-title">{initial ? "Редактировать формат" : "Новый формат"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Закрыть редактор"
          >
            <XIcon />
          </button>
        </div>
        <form className="format-form" onSubmit={submit}>
          <label className="field field--wide">
            <span>Название *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="field field--wide">
            <span>Площадка или группа *</span>
            <input value={group} onChange={(event) => setGroup(event.target.value)} required />
          </label>
          <label className="field">
            <span>Ширина, px *</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Высота, px *</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Тип файла *</span>
            <select
              value={mimeType}
              onChange={(event) => setMimeType(event.target.value as OutputMimeType)}
            >
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
            </select>
          </label>
          <label className="field">
            <span>Максимум, КБ *</span>
            <input
              type="number"
              min="1"
              max="102400"
              value={maxKb}
              onChange={(event) => setMaxKb(event.target.value)}
              required
            />
          </label>
          <label className="field field--wide">
            <span>Требования к кадру</span>
            <textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Например: сохранить лицо и микрофон"
            />
          </label>
          <label className="field field--wide">
            <span>Шаблон имени *</span>
            <input
              value={filenameTemplate}
              onChange={(event) => setFilenameTemplate(event.target.value)}
              required
            />
            <small>
              Поля: {"{sourceBase}"}, {"{formatName}"}, {"{formatSlug}"}, {"{width}"}, {"{height}"},{" "}
              {"{ext}"}
            </small>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal__actions field--wide">
            <button type="button" className="button button--ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="button button--primary">
              Сохранить формат
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
