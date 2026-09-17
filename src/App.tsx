import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createResultsZip } from "./lib/archive";
import { DEFAULT_MODEL, MODEL_PROFILES } from "./config/models";
import { DEFAULT_FORMATS } from "./data/default-formats";
import { createFormatId } from "./lib/format";
import {
  importCatalog,
  loadCustomFormats,
  resetCustomFormats,
  saveCustomFormats,
  exportCatalog,
} from "./lib/storage";
import { MAX_UPLOAD_BYTES, readImageDimensions } from "./lib/image";
import { analyzePhoto, createMockAnalysis } from "./lib/deepseek";
import { mapConcurrent, runPhotoPipeline } from "./lib/pipeline";
import type { ModelId, OutputFormat, PhotoItem } from "./types";
import { FormatCatalog } from "./components/FormatCatalog";
import { FormatEditor } from "./components/FormatEditor";
import {
  CheckIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "./components/Icons";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function describeError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "Операция отменена.";
  if (error instanceof TypeError)
    return "Не удалось связаться с DeepSeek API. Проверьте сеть и повторите попытку.";
  if (error instanceof RangeError) return "Браузеру не хватило памяти для обработки изображения.";
  return error instanceof Error ? error.message : "Неизвестная ошибка обработки.";
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [customFormats, setCustomFormats] = useState<OutputFormat[]>(() =>
    loadCustomFormats(localStorage),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [notice, setNotice] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFormat, setEditingFormat] = useState<OutputFormat | undefined>();
  const [isDragging, setIsDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PhotoItem[]>([]);

  const formats = useMemo(() => [...DEFAULT_FORMATS, ...customFormats], [customFormats]);
  const selectedFormats = useMemo(
    () => formats.filter((format) => selectedIds.has(format.id)),
    [formats, selectedIds],
  );
  const successfulCount = photos.reduce(
    (count, photo) => count + photo.outputs.filter((output) => output.limitMet).length,
    0,
  );
  const failedCount = photos.filter((photo) => photo.status === "error").length;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.previewUrl);
        photo.outputs.forEach((output) => URL.revokeObjectURL(output.objectUrl));
      }
    },
    [],
  );

  function persistCustom(next: OutputFormat[]) {
    setCustomFormats(next);
    saveCustomFormats(localStorage, next);
  }

  async function addFiles(fileList: FileList | File[]) {
    setNotice("");
    const files = Array.from(fileList);
    const valid = files.filter((file) => {
      if (!ACCEPTED_TYPES.has(file.type)) {
        setNotice("Поддерживаются JPEG, PNG и WebP. Неподдерживаемые файлы пропущены.");
        return false;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setNotice("Файлы больше 30 МБ пропущены.");
        return false;
      }
      return true;
    });

    const next: PhotoItem[] = [];
    let rejected = false;
    for (const file of valid) {
      try {
        const dimensions = await readImageDimensions(file);
        next.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          ...dimensions,
          specificPrompt: "",
          status: "idle",
          progress: 0,
          statusText: "Готово к запуску",
          outputs: [],
        });
      } catch {
        rejected = true;
      }
    }
    if (rejected) {
      setNotice("Некоторые изображения не удалось прочитать или они слишком велики.");
    }
    setPhotos((current) => [...current, ...next]);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        removed.outputs.forEach((output) => URL.revokeObjectURL(output.objectUrl));
      }
      return current.filter((photo) => photo.id !== id);
    });
  }

  function clearPhotos() {
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.previewUrl);
      photo.outputs.forEach((output) => URL.revokeObjectURL(output.objectUrl));
    });
    setPhotos([]);
  }

  function toggleFormat(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function duplicateFormat(format: OutputFormat) {
    const copy: OutputFormat = {
      ...format,
      id: createFormatId(`${format.name}-копия`),
      name: `${format.name} — копия`,
      builtIn: false,
    };
    persistCustom([...customFormats, copy]);
    setSelectedIds((current) => new Set(current).add(copy.id));
    setNotice("Формат продублирован и добавлен в «Мои форматы».");
  }

  function saveFormat(format: OutputFormat) {
    const exists = customFormats.some((item) => item.id === format.id);
    persistCustom(
      exists
        ? customFormats.map((item) => (item.id === format.id ? format : item))
        : [...customFormats, format],
    );
    setSelectedIds((current) => new Set(current).add(format.id));
    setEditorOpen(false);
    setEditingFormat(undefined);
  }

  function deleteFormat(format: OutputFormat) {
    persistCustom(customFormats.filter((item) => item.id !== format.id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(format.id);
      return next;
    });
  }

  function restoreDefaults() {
    resetCustomFormats(localStorage);
    setCustomFormats([]);
    setSelectedIds(
      (current) =>
        new Set([...current].filter((id) => DEFAULT_FORMATS.some((item) => item.id === id))),
    );
    setNotice("Пользовательские форматы удалены, стандартный каталог восстановлен.");
  }

  function exportFormats() {
    downloadBlob(
      new Blob([exportCatalog(formats)], { type: "application/json" }),
      "photo-formats.json",
    );
  }

  async function importFormats(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = importCatalog(await file.text());
      const occupied = new Set(formats.map((format) => format.id));
      const unique = imported.map((format) => {
        let id = format.id;
        while (occupied.has(id)) id = `${id}-copy`;
        occupied.add(id);
        return { ...format, id };
      });
      persistCustom([...customFormats, ...unique]);
      setNotice(`Импортировано форматов: ${unique.length}.`);
    } catch (error) {
      setNotice(describeError(error));
    }
  }

  async function processPhotos(onlyFailed = false) {
    const targets = photos.filter((photo) => (onlyFailed ? photo.status === "error" : true));
    if (!apiKey.trim() || !targets.length || !selectedFormats.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setNotice("");
    const targetIds = new Set(targets.map((photo) => photo.id));
    setPhotos((current) =>
      current.map((photo) => {
        if (!targetIds.has(photo.id)) return photo;
        photo.outputs.forEach((output) => URL.revokeObjectURL(output.objectUrl));
        return {
          ...photo,
          outputs: [],
          error: undefined,
          status: "queued",
          progress: 2,
          statusText: "В очереди",
        };
      }),
    );

    try {
      await mapConcurrent(targets, 2, async (photo) => {
        if (controller.signal.aborted) {
          setPhotos((current) =>
            current.map((item) =>
              item.id === photo.id
                ? {
                    ...item,
                    status: "cancelled",
                    statusText: "Отменено",
                    error: "Операция отменена.",
                  }
                : item,
            ),
          );
          return;
        }
        try {
          const outputs = await runPhotoPipeline(
            {
              file: photo.file,
              formats: selectedFormats,
              apiKey: apiKey.trim(),
              model,
              globalPrompt,
              photoPrompt: photo.specificPrompt,
              signal: controller.signal,
              onUpdate: (update) =>
                setPhotos((current) =>
                  current.map((item) =>
                    item.id === photo.id ? { ...item, ...update, statusText: update.text } : item,
                  ),
                ),
            },
            {
              analyze:
                import.meta.env.VITE_MOCK_DEEPSEEK === "true"
                  ? async (input) =>
                      createMockAnalysis(input.formats, input.sourceWidth, input.sourceHeight)
                  : analyzePhoto,
            },
          );
          setPhotos((current) =>
            current.map((item) =>
              item.id === photo.id
                ? {
                    ...item,
                    outputs,
                    status: "done",
                    progress: 100,
                    statusText: "Готово",
                    error: undefined,
                  }
                : item,
            ),
          );
        } catch (error) {
          const cancelled = error instanceof DOMException && error.name === "AbortError";
          setPhotos((current) =>
            current.map((item) =>
              item.id === photo.id
                ? {
                    ...item,
                    status: cancelled ? "cancelled" : "error",
                    statusText: cancelled ? "Отменено" : "Ошибка",
                    error: describeError(error),
                  }
                : item,
            ),
          );
        }
      });
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  }

  function cancelProcessing() {
    abortRef.current?.abort();
  }

  async function downloadZip() {
    setIsZipping(true);
    try {
      const blob = await createResultsZip(photos);
      downloadBlob(blob, "prepared-photos.zip");
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setIsZipping(false);
    }
  }

  const disabledReason = !photos.length
    ? "Добавьте хотя бы одну фотографию"
    : !selectedFormats.length
      ? "Выберите хотя бы один формат"
      : !apiKey.trim()
        ? "Введите DeepSeek API key"
        : "";

  return (
    <div className="app-shell">
      <header className="hero">
        <nav className="nav" aria-label="Основная навигация">
          <a className="brand" href="#top" aria-label="Кадр — наверх">
            <span className="brand__mark">
              <SparkIcon size={20} />
            </span>
            <span>Кадр</span>
          </a>
          <span className="nav__privacy">
            <span /> Обработка в браузере
          </span>
        </nav>
        <div className="hero__content" id="top">
          <p className="eyebrow eyebrow--light">Умная подготовка фотографий</p>
          <h1>
            Один кадр.
            <br />
            <em>Все нужные форматы.</em>
          </h1>
          <p className="hero__lead">
            DeepSeek помогает выбрать композицию, а кадрирование, цвет и сжатие выполняются локально
            — прямо в этой вкладке.
          </p>
          <div className="hero__facts">
            <span>
              <CheckIcon /> Исходники не хранятся
            </span>
            <span>
              <CheckIcon /> Точные размеры
            </span>
            <span>
              <CheckIcon /> Один ZIP-архив
            </span>
          </div>
        </div>
      </header>

      <main>
        {notice && (
          <div className="notice" role="status" aria-live="polite">
            {notice}
            <button type="button" onClick={() => setNotice("")} aria-label="Закрыть сообщение">
              <XIcon size={17} />
            </button>
          </div>
        )}

        <section className="section settings-section" aria-labelledby="access-title">
          <div className="section-heading">
            <span className="step">01</span>
            <div>
              <p className="eyebrow">Доступ и модель</p>
              <h2 id="access-title">Подключите DeepSeek</h2>
            </div>
          </div>
          <div className="settings-grid">
            <div className="panel key-panel">
              <label className="field">
                <span>DeepSeek API key</span>
                <div className="password-input">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? "Скрыть API key" : "Показать API key"}
                  >
                    {showKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </label>
              <div className="security-note">
                <strong>Ключ хранится только в памяти вкладки</strong>
                <p>
                  Браузер обращается напрямую к официальному DeepSeek API. Ключ доступен JavaScript
                  страницы — используйте только доверенную сборку и отдельный ключ с небольшим
                  лимитом расходов.
                </p>
              </div>
            </div>
            <div className="panel">
              <fieldset className="model-picker">
                <legend>Профиль модели</legend>
                {MODEL_PROFILES.map((profile) => (
                  <label
                    className={
                      model === profile.id ? "model-option model-option--active" : "model-option"
                    }
                    key={profile.id}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={profile.id}
                      checked={model === profile.id}
                      onChange={() => setModel(profile.id)}
                    />
                    <span>
                      <strong>{profile.label}</strong>
                      <small>{profile.description}</small>
                    </span>
                    <code>{profile.id}</code>
                  </label>
                ))}
              </fieldset>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="photos-title">
          <div className="section-heading section-heading--between">
            <div className="section-heading__title">
              <span className="step">02</span>
              <div>
                <p className="eyebrow">Исходники</p>
                <h2 id="photos-title">Добавьте фотографии</h2>
              </div>
            </div>
            {photos.length > 0 && (
              <button
                className="text-button danger"
                type="button"
                onClick={clearPhotos}
                disabled={isProcessing}
              >
                <TrashIcon size={17} /> Очистить список
              </button>
            )}
          </div>
          <label
            className={`dropzone ${isDragging ? "dropzone--active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event: DragEvent<HTMLLabelElement>) => {
              event.preventDefault();
              setIsDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => event.target.files && void addFiles(event.target.files)}
              disabled={isProcessing}
            />
            <span className="dropzone__icon">
              <UploadIcon size={30} />
            </span>
            <strong>Перетащите фото сюда</strong>
            <span>или нажмите, чтобы выбрать · JPEG, PNG, WebP до 30 МБ</span>
          </label>

          {photos.length > 0 && (
            <div className="photo-list">
              {photos.map((photo) => (
                <article className="photo-row" key={photo.id}>
                  <img src={photo.previewUrl} alt="" />
                  <div className="photo-row__main">
                    <div className="photo-row__title">
                      <strong>{photo.file.name}</strong>
                      <span>
                        {photo.width} × {photo.height} · {formatBytes(photo.file.size)}
                      </span>
                    </div>
                    <label className="photo-prompt">
                      <span className="sr-only">Уточнение для {photo.file.name}</span>
                      <input
                        value={photo.specificPrompt}
                        onChange={(event) =>
                          setPhotos((current) =>
                            current.map((item) =>
                              item.id === photo.id
                                ? { ...item, specificPrompt: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="Уточнение для этого фото (необязательно)"
                        disabled={isProcessing}
                      />
                    </label>
                    {photo.status !== "idle" && (
                      <div className="job-progress" aria-live="polite">
                        <div>
                          <span>{photo.statusText}</span>
                          <span>{Math.round(photo.progress)}%</span>
                        </div>
                        <progress value={photo.progress} max="100" />
                        {photo.error && <p className="job-error">{photo.error}</p>}
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    disabled={isProcessing}
                    aria-label={`Удалить ${photo.file.name}`}
                  >
                    <TrashIcon />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="formats-title">
          <div className="section-heading section-heading--between">
            <div className="section-heading__title">
              <span className="step">03</span>
              <div>
                <p className="eyebrow">Выходные файлы</p>
                <h2 id="formats-title">Выберите форматы</h2>
              </div>
            </div>
            <div className="catalog-actions">
              <button
                className="button button--small button--primary"
                type="button"
                onClick={() => {
                  setEditingFormat(undefined);
                  setEditorOpen(true);
                }}
                disabled={isProcessing}
              >
                + Свой формат
              </button>
              <button className="text-button" type="button" onClick={exportFormats}>
                Экспорт JSON
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => importRef.current?.click()}
                disabled={isProcessing}
              >
                Импорт
              </button>
              <button
                className="text-button"
                type="button"
                onClick={restoreDefaults}
                disabled={isProcessing}
              >
                Восстановить
              </button>
              <input
                className="sr-only"
                ref={importRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void importFormats(event)}
              />
            </div>
          </div>
          <FormatCatalog
            formats={formats}
            selectedIds={selectedIds}
            disabled={isProcessing}
            onToggle={toggleFormat}
            onEdit={(format) => {
              setEditingFormat(format);
              setEditorOpen(true);
            }}
            onDuplicate={duplicateFormat}
            onDelete={deleteFormat}
          />
        </section>

        <section className="section" aria-labelledby="prompt-title">
          <div className="section-heading">
            <span className="step">04</span>
            <div>
              <p className="eyebrow">Творческое уточнение</p>
              <h2 id="prompt-title">Что особенно важно?</h2>
            </div>
          </div>
          <div className="prompt-panel">
            <label className="field">
              <span>Общий prompt для всей партии</span>
              <textarea
                rows={4}
                value={globalPrompt}
                onChange={(event) => setGlobalPrompt(event.target.value)}
                placeholder="Например: человек должен оставаться по центру; главный объект — сцена, а не зрители"
                disabled={isProcessing}
              />
            </label>
            <p>
              <SparkIcon size={18} /> Модель использует уточнение вместе с требованиями каждого
              формата. Оно не может разрешить дорисовку или удаление объектов.
            </p>
          </div>
        </section>

        <section className="run-panel" aria-labelledby="run-title">
          <div>
            <p className="eyebrow eyebrow--light">Всё готово?</p>
            <h2 id="run-title">
              Подготовить {photos.length || 0} {photos.length === 1 ? "фотографию" : "фотографий"}
            </h2>
            <p>
              Основных API-запросов: {photos.length}. Возможен один repair-повтор на фото и
              временные сетевые повторы.
            </p>
          </div>
          <div className="run-panel__actions">
            {isProcessing ? (
              <button
                className="button button--danger button--large"
                type="button"
                onClick={cancelProcessing}
              >
                Остановить обработку
              </button>
            ) : (
              <button
                className="button button--accent button--large"
                type="button"
                onClick={() => void processPhotos()}
                disabled={Boolean(disabledReason)}
              >
                <SparkIcon size={20} /> Подготовить изображения
              </button>
            )}
            {disabledReason && !isProcessing && <span>{disabledReason}</span>}
            {failedCount > 0 && !isProcessing && (
              <button
                className="text-button text-button--light"
                type="button"
                onClick={() => void processPhotos(true)}
              >
                Повторить только ошибки ({failedCount})
              </button>
            )}
          </div>
        </section>

        {photos.some((photo) => photo.outputs.length > 0) && (
          <section className="section results" aria-labelledby="results-title">
            <div className="section-heading section-heading--between">
              <div className="section-heading__title">
                <span className="step">05</span>
                <div>
                  <p className="eyebrow">Результаты</p>
                  <h2 id="results-title">Готовые изображения</h2>
                </div>
              </div>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void downloadZip()}
                disabled={!successfulCount || isZipping}
              >
                <DownloadIcon />{" "}
                {isZipping ? "Собираем ZIP…" : `Скачать всё ZIP · ${successfulCount}`}
              </button>
            </div>
            <div className="result-list">
              {photos
                .filter((photo) => photo.outputs.length)
                .map((photo) => (
                  <article className="result-source" key={photo.id}>
                    <div className="result-source__header">
                      <ImageIcon />
                      <div>
                        <strong>{photo.file.name}</strong>
                        <span>{photo.outputs.length} вариантов</span>
                      </div>
                    </div>
                    <div className="result-grid">
                      {photo.outputs.map((output) => (
                        <article className="result-card" key={output.format.id}>
                          <div
                            className="result-preview"
                            style={{
                              aspectRatio: `${output.actualWidth} / ${output.actualHeight}`,
                            }}
                          >
                            <img
                              src={output.objectUrl}
                              alt={`${output.format.name}, результат`}
                              width={output.actualWidth}
                              height={output.actualHeight}
                              loading="lazy"
                            />
                          </div>
                          <div className="result-card__body">
                            <div>
                              <p className="result-card__group">{output.format.group}</p>
                              <h3>{output.format.name}</h3>
                            </div>
                            <dl>
                              <div>
                                <dt>Размер</dt>
                                <dd>
                                  {output.actualWidth} × {output.actualHeight}
                                </dd>
                              </div>
                              <div>
                                <dt>Файл</dt>
                                <dd>
                                  {output.format.extension.toUpperCase()} ·{" "}
                                  {formatBytes(output.blob.size)}
                                </dd>
                              </div>
                            </dl>
                            <span
                              className={
                                output.limitMet
                                  ? "status-pill status-pill--ok"
                                  : "status-pill status-pill--warning"
                              }
                            >
                              {output.limitMet ? (
                                <>
                                  <CheckIcon size={15} /> Лимит соблюдён
                                </>
                              ) : (
                                "Превышен лимит — только отдельно"
                              )}
                            </span>
                            {output.warnings.length > 0 && (
                              <details>
                                <summary>Предупреждения ({output.warnings.length})</summary>
                                <ul>
                                  {output.warnings.map((warning, index) => (
                                    <li key={`${warning}-${index}`}>{warning}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            <button
                              className="button button--outline"
                              type="button"
                              onClick={() => downloadBlob(output.blob, output.filename)}
                            >
                              <DownloadIcon /> Скачать файл
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                ))}
            </div>
          </section>
        )}
      </main>

      <footer>
        <span className="brand brand--footer">
          <span className="brand__mark">
            <SparkIcon size={18} />
          </span>
          Кадр
        </span>
        <p>
          Фотографии обрабатываются локально. В DeepSeek уходит только уменьшенная копия для
          анализа.
        </p>
      </footer>

      {editorOpen && (
        <FormatEditor
          key={editingFormat?.id ?? "new"}
          initial={editingFormat}
          onSave={saveFormat}
          onClose={() => {
            setEditorOpen(false);
            setEditingFormat(undefined);
          }}
        />
      )}
    </div>
  );
}
