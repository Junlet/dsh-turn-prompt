window.__ModuleLoader__.load({
  id: 'dsh-turn-prompt',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    let createPortal = null;
    try {
      const dom = require('react-dom');
      if (dom && typeof dom.createPortal === 'function') createPortal = dom.createPortal;
    } catch {
      // Without react-dom the panel renders inline; the selection still works.
    }

    /** Locale namespace the panel text is contributed under. */
    const NS = 'turn-prompt';
    const STORAGE_KEY = 'dsh-turn-prompt:sets:v1';
    const ROUTE = { arm: 'api/turn-prompt.arm', state: 'api/turn-prompt.state' };

    const zh = {
      'trigger.default': '提示词',
      'trigger.hint': '本轮提示词',
      'panel.title': '本轮提示词',
      'panel.manage': '管理',
      'panel.back': '返回',
      'panel.default': '默认（不附加提示词）',
      'panel.defaultHint': '每轮结束后自动回到这里',
      'panel.activeHint': '本轮生效：从现在起到本轮结束，发给模型的本轮提示词包含这套内容。',
      'panel.empty': '还没有自定义提示词，用「新增」加一套。',
      'panel.add': '新增',
      'panel.reset': '恢复默认',
      'panel.delete': '删除',
      'panel.name': '名称',
      'panel.text': '提示词内容',
      'panel.textPlaceholder': '写给模型的补充要求，发送前自动加入本轮提示词。',
      'panel.added': '新提示词',
      'panel.failed': '宿主机没有接受这次选择',
      'panel.noSession': '这个会话还没准备好',
    };

    const en = {
      'trigger.default': 'Prompt',
      'trigger.hint': 'Turn prompt',
      'panel.title': 'Turn prompt',
      'panel.manage': 'Manage',
      'panel.back': 'Back',
      'panel.default': 'Default (no extra prompt)',
      'panel.defaultHint': 'Returns here when the turn ends',
      'panel.activeHint': 'Active for this turn: the prompt sent to the model carries this text until the turn ends.',
      'panel.empty': 'No custom prompts yet. Use Add to create one.',
      'panel.add': 'Add',
      'panel.reset': 'Restore defaults',
      'panel.delete': 'Delete',
      'panel.name': 'Name',
      'panel.text': 'Prompt text',
      'panel.textPlaceholder': 'Extra instructions added to this turn’s prompt before sending.',
      'panel.added': 'New prompt',
      'panel.failed': 'The Host did not accept the selection',
      'panel.noSession': 'This Session is not ready',
    };

    /** Shipped prompt sets; names and bodies follow the interface language. */
    const DEFAULT_SETS = [
      {
        id: 'concise',
        title: { zh: '简洁作答', en: 'Concise answers' },
        text: {
          zh: '请尽量精简地回答：先给结论，再列必要的理由或步骤。不要复述我的问题，不要重复已经确认过的信息。',
          en: 'Answer as briefly as you can: the conclusion first, then only the reasoning or steps it needs. Do not restate the question or repeat confirmed facts.',
        },
      },
      {
        id: 'examine',
        title: { zh: '先审后答', en: 'Examine first' },
        text: {
          zh: '回答之前先检查前提：列出你依赖的关键假设，指出可能出错的地方与反例，并标出不确定之处；确认无误后再给出结论。',
          en: 'Before answering, examine the premises: list the key assumptions you rely on, name what could be wrong and any counterexamples, and flag what is uncertain. Give the conclusion once that holds up.',
        },
      },
      {
        id: 'code',
        title: { zh: '代码严谨', en: 'Careful code' },
        text: {
          zh: '涉及代码时：给出可直接运行的完整片段，标明语言与依赖，说明关键取舍与边界条件。不要省略错误处理和必要的导入。',
          en: 'Where code is involved: give complete, runnable snippets, name the language and dependencies, and state the key tradeoffs and edge cases. Keep error handling and necessary imports.',
        },
      },
    ];

    /**
     * Pick the interface language from the document.
     * @returns 'zh' or 'en'.
     */
    function detectLanguage() {
      let raw = '';
      try {
        raw = (typeof document !== 'undefined' && document.documentElement.lang) || '';
        if (raw === '' && typeof navigator !== 'undefined') raw = navigator.language || '';
      } catch {
        raw = '';
      }
      return /^zh/i.test(raw) ? 'zh' : 'en';
    }

    const LANGUAGE = detectLanguage();
    const DICTIONARY = LANGUAGE === 'zh' ? zh : en;

    /**
     * Resolve one interface string.
     * @param key - dictionary key.
     * @returns localized text.
     */
    function tr(key) {
      return DICTIONARY[key] ?? en[key] ?? key;
    }

    /**
     * Build the shipped defaults for this language.
     * @returns prompt sets.
     */
    function defaultSets() {
      return DEFAULT_SETS.map(set => ({ id: set.id, title: set.title[LANGUAGE] ?? set.title.en, text: set.text[LANGUAGE] ?? set.text.en }));
    }

    /**
     * Read the stored prompt sets.
     * @returns prompt sets, falling back to the shipped defaults.
     */
    function readSets() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const sets = [];
            for (const entry of parsed) {
              if (entry === null || typeof entry !== 'object') continue;
              const title = typeof entry.title === 'string' ? entry.title : '';
              const text = typeof entry.text === 'string' ? entry.text : '';
              sets.push({ id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `set-${sets.length + 1}`, title, text });
            }
            return sets;
          }
        }
      } catch {
        // Unreadable storage falls back to the shipped defaults.
      }
      return defaultSets();
    }

    /**
     * Persist prompt sets; a full or blocked store keeps the session working.
     * @param sets - prompt sets to store.
     */
    function writeSets(sets) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
      } catch {
        // Storage is a convenience here, never the source of truth for the turn.
      }
    }

    /**
     * Call one bridge route, resolving the base prefix once.
     * @param path - route path without a leading slash.
     * @param body - JSON body.
     * @returns the parsed response.
     */
    async function bridge(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    }

    /**
     * Mount the panel outside the clipped composer; without a portal the panel
     * still renders in place, which keeps the selection usable.
     * @param node - panel element.
     * @returns the mounted element.
     */
    const mountPanel = node =>
      createPortal === null ? h('span', { style: { display: 'contents' } }, node) : createPortal(node, document.body);

    const buttonStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: '28px',
      maxWidth: '100%',
      padding: '0 8px',
      border: '0',
      borderRadius: 'var(--dsw-radius-sm)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '20px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '7px 10px',
      border: '0',
      borderRadius: 'var(--dsw-radius-sm)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '18px',
      textAlign: 'left',
      cursor: 'pointer',
    };

    const fieldStyle = {
      width: '100%',
      boxSizing: 'border-box',
      border: '0.5px solid var(--dsw-alias-border-l1)',
      borderRadius: 'var(--dsw-radius-sm)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
      padding: '5px 7px',
    };

    /**
     * The composer accessory: one control that picks this turn's prompt set.
     * @param props - Session-scoped slot props.
     * @returns the trigger and, while open, its panel.
     */
    function TurnPrompt(props) {
      const sessionId = props?.sessionId ?? props?.session?.sessionId ?? props?.session?.id ?? null;
      const [sets, setSets] = useState(readSets);
      const [armed, setArmed] = useState(null);
      const [open, setOpen] = useState(false);
      const [managing, setManaging] = useState(false);
      const [rect, setRect] = useState(null);
      const [failure, setFailure] = useState('');
      const triggerRef = useRef(null);
      const panelRef = useRef(null);

      // Mirror the Host: a page reload or another tab may hold the arm.
      useEffect(() => {
        if (sessionId === null) return undefined;
        let live = true;
        bridge(ROUTE.state, { sessionId }).then(
          state => {
            if (live && state?.armed) setArmed({ id: String(state.id ?? ''), title: String(state.title ?? '') });
          },
          () => {},
        );
        return () => {
          live = false;
        };
      }, [sessionId]);

      // The Host retires the arm at the end of the turn; follow it back to default.
      useEffect(() => {
        if (sessionId === null || armed === null) return undefined;
        let live = true;
        const timer = window.setInterval(() => {
          bridge(ROUTE.state, { sessionId }).then(
            state => {
              if (live && state?.armed !== true) setArmed(null);
            },
            () => {},
          );
        }, 2000);
        return () => {
          live = false;
          window.clearInterval(timer);
        };
      }, [sessionId, armed]);

      const close = useCallback(() => {
        setOpen(false);
        setManaging(false);
        triggerRef.current?.focus?.();
      }, []);

      // Dismissal: outside press, Escape, or a viewport change that moves the trigger.
      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = event => {
          const target = event.target;
          if (panelRef.current?.contains(target) === true) return;
          if (triggerRef.current?.contains(target) === true) return;
          setOpen(false);
          setManaging(false);
        };
        const onKeyDown = event => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          setOpen(false);
          setManaging(false);
          triggerRef.current?.focus?.();
        };
        const onMove = () => {
          const element = triggerRef.current;
          if (element !== null) setRect(element.getBoundingClientRect());
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('resize', onMove);
          window.removeEventListener('scroll', onMove, true);
        };
      }, [open]);

      const toggle = () => {
        if (open) {
          close();
          return;
        }
        const element = triggerRef.current;
        if (element !== null) setRect(element.getBoundingClientRect());
        setFailure('');
        setOpen(true);
      };

      /**
       * Arm one set for this Session, or clear the arm with `null`.
       * @param entry - prompt set, or null for the default.
       */
      const choose = async entry => {
        if (sessionId === null) return;
        setArmed(entry === null ? null : { id: entry.id, title: entry.title });
        setOpen(false);
        setManaging(false);
        setFailure('');
        try {
          await bridge(ROUTE.arm, entry === null
            ? { sessionId, id: '', title: '', text: '' }
            : { sessionId, id: entry.id, title: entry.title, text: entry.text });
        } catch {
          setFailure(tr('panel.failed'));
        }
      };

      const persist = next => {
        setSets(next);
        writeSets(next);
      };

      const updateSet = (id, patch) => {
        persist(sets.map(set => (set.id === id ? { ...set, ...patch } : set)));
      };

      const addSet = () => {
        const id = `custom-${Date.now().toString(36)}`;
        persist([...sets, { id, title: tr('panel.added'), text: '' }]);
      };

      const removeSet = id => {
        const next = sets.filter(set => set.id !== id);
        persist(next);
        if (armed !== null && armed.id === id) void choose(null);
      };

      const resetSets = () => persist(defaultSets());

      const armedTitle = armed === null ? '' : armed.title !== '' ? armed.title : armed.id;
      const label = armedTitle !== '' ? armedTitle : tr('trigger.default');
      const triggerStyle = {
        ...buttonStyle,
        color: armedTitle !== '' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
        maxWidth: '180px',
      };

      let panel = null;
      if (open && rect !== null) {
        const width = Math.min(340, Math.max(240, window.innerWidth - 16));
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const bottom = Math.max(8, window.innerHeight - rect.top + 8);
        panel = mountPanel(
          h(
            'div',
            {
              ref: panelRef,
              role: 'dialog',
              'aria-label': tr('panel.title'),
              'data-dsh-turn-prompt': 'panel',
              style: {
                position: 'fixed',
                zIndex: 2147483000,
                left: `${left}px`,
                bottom: `${bottom}px`,
                width: `${width}px`,
                boxSizing: 'border-box',
                padding: '6px',
                border: '0.5px solid var(--dsw-alias-border-l2)',
                borderRadius: 'var(--dsw-radius-lg)',
                background: 'var(--dsw-alias-bg-layer-1)',
                color: 'var(--dsw-alias-label-primary)',
                font: 'inherit',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 'min(72vh, 540px)',
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 6px 6px' } },
              h('span', { style: { fontSize: '12px', fontWeight: 500 } }, tr('panel.title')),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => setManaging(value => !value),
                  style: { ...buttonStyle, height: '22px', padding: '0 6px', cursor: 'pointer' },
                },
                managing ? tr('panel.back') : tr('panel.manage'),
              ),
            ),
            managing
              ? h(
                  'div',
                  { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px' } },
                  sets.length === 0
                    ? h('span', { style: { padding: '6px 2px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' } }, tr('panel.empty'))
                    : null,
                  ...sets.map(set =>
                    h(
                      'div',
                      { key: set.id, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                      h('input', {
                        value: set.title,
                        'aria-label': tr('panel.name'),
                        placeholder: tr('panel.name'),
                        onChange: event => updateSet(set.id, { title: event.target.value }),
                        style: fieldStyle,
                      }),
                      h('textarea', {
                        value: set.text,
                        'aria-label': tr('panel.text'),
                        placeholder: tr('panel.textPlaceholder'),
                        rows: 3,
                        onChange: event => updateSet(set.id, { text: event.target.value }),
                        style: { ...fieldStyle, resize: 'vertical', minHeight: '54px' },
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => removeSet(set.id),
                          style: { ...buttonStyle, alignSelf: 'flex-end', height: '22px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
                        },
                        tr('panel.delete'),
                      ),
                    ),
                  ),
                )
              : h(
                  'div',
                  { role: 'listbox', 'aria-label': tr('panel.title'), style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1px', padding: '0 4px' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'option',
                      'aria-selected': armed === null,
                      onClick: () => void choose(null),
                      style: { ...rowStyle, color: armed === null ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)' },
                    },
                    h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, tr('panel.default')),
                    armed === null ? h('span', { style: { color: 'var(--dsw-alias-state-business-primary)', fontSize: '12px' } }, '✓') : null,
                  ),
                  ...sets.map(set =>
                    h(
                      'button',
                      {
                        key: set.id,
                        type: 'button',
                        role: 'option',
                        'aria-selected': armed !== null && armed.id === set.id,
                        title: set.text.slice(0, 400),
                        onClick: () => void choose(set),
                        style: {
                          ...rowStyle,
                          background: armed !== null && armed.id === set.id ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                        },
                      },
                      h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, set.title !== '' ? set.title : set.text.slice(0, 40)),
                      armed !== null && armed.id === set.id
                        ? h('span', { style: { color: 'var(--dsw-alias-state-business-primary)', fontSize: '12px' } }, '✓')
                        : null,
                    ),
                  ),
                ),
            h(
              'div',
              {
                style: {
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 4px 2px',
                  color: 'var(--dsw-alias-label-tertiary)',
                  fontSize: '11px',
                  lineHeight: '16px',
                },
              },
              managing
                ? h(
                    React.Fragment,
                    null,
                    h(
                      'button',
                      { type: 'button', onClick: addSet, style: { ...buttonStyle, height: '24px', color: 'var(--dsw-alias-state-business-primary)' } },
                      tr('panel.add'),
                    ),
                    h(
                      'button',
                      { type: 'button', onClick: resetSets, style: { ...buttonStyle, height: '24px', color: 'var(--dsw-alias-label-tertiary)' } },
                      tr('panel.reset'),
                    ),
                  )
                : h('span', { role: 'status' }, failure !== '' ? failure : armed === null ? tr('panel.defaultHint') : tr('panel.activeHint')),
            ),
          ),
        );
      }

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            'data-dsh-turn-prompt': 'trigger',
            'data-armed': armed === null ? 'false' : 'true',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': armedTitle === '' ? tr('trigger.hint') : `${tr('trigger.hint')}: ${armedTitle}`,
            title: sessionId === null ? tr('panel.noSession') : tr('trigger.hint'),
            onClick: toggle,
            style: triggerStyle,
          },
          h(
            'svg',
            { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
            h('path', {
              d: 'M2.75 3.75h10.5M2.75 8h6.5M2.75 12.25h8.5',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.4,
              strokeLinecap: 'round',
            }),
          ),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
        ),
        panel,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        let localeReady = false;
        try {
          const locale = ctx.get('locale');
          if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
            locale.register(NS, { zh, en });
            localeReady = true;
          }
        } catch {
          // Without the locale service the panel falls back to its own dictionary.
        }
        ctx.effect(() =>
          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: 'dsh-turn-prompt',
                order: 20,
                label: () => 'dsh-turn-prompt',
                ...(localeReady ? { locale: NS } : {}),
              },
              TurnPrompt,
            ),
          ),
        );
      },
    };
  },
});
