'use strict';

const obsidian = require('obsidian');

/**
 * Sidebar Presets
 *
 * 우측 사이드바 레이아웃을 A/B 두 슬롯으로 토글.
 *
 * 전략: CSS display:none 기반 — DOM을 이동하지 않고 가시성만 전환.
 *  - 탭 그룹에 data-sidebar-preset="A|B" 태그
 *  - 컨테이너에 data-active-preset="A|B" 태그
 *  - CSS로 비활성 프리셋 숨김
 *  - 리사이즈 핸들/접기 버튼 항상 살아있음
 */
class SidebarPresetsPlugin extends obsidian.Plugin {

	async onload() {
		this.settings = Object.assign(
			{ activeSlot: 'A', widths: { A: null, B: null }, groupCounts: { A: 0, B: 0 } },
			await this.loadData(),
		);
		this.toggleBtnEl = null;
		this._knownTabGroups = new Set();
		this._wasCollapsed = false;

		this.addCommand({
			id: 'toggle-right-sidebar-preset',
			name: '우측 사이드바 프리셋 전환',
			callback: () => this.toggle(),
		});

		this.app.workspace.onLayoutReady(() => {
			this.initPresets();
			this.applyVisibility();
			this.restoreActiveWidth();
			this.injectButton();
		});

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.tagNewTabGroups();

				// 사이드바가 접혔다가 펼쳐지면 활성 프리셋 너비 재적용
				const rightSplit = this.app.workspace.rightSplit;
				const isCollapsed = rightSplit.collapsed;
				if (this._wasCollapsed && !isCollapsed) {
					const activeWidth = this.settings.widths?.[this.settings.activeSlot];
					if (activeWidth) {
						rightSplit.width = activeWidth;
						rightSplit.containerEl.style.width = activeWidth + 'px';
					}
				}
				this._wasCollapsed = isCollapsed;

				if (!this.toggleBtnEl || !this.toggleBtnEl.isConnected) {
					this.injectButton();
				}
			}),
		);
	}

	onunload() {
		// 태그·스타일 정리
		const rightSplit = this.app.workspace.rightSplit;
		if (rightSplit?.containerEl) {
			delete rightSplit.containerEl.dataset.activePreset;
			for (const el of rightSplit.containerEl.children) {
				delete el.dataset.sidebarPreset;
				el.style.display = '';
			}
		}
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}
	}

	// ─── 초기화: 기존 탭 그룹에 프리셋 태그 ───

	initPresets() {
		const rightSplit = this.app.workspace.rightSplit;
		const children = rightSplit.children;
		const aCount = this.settings.groupCounts?.A || children.length;

		for (let i = 0; i < children.length; i++) {
			const tg = children[i];
			tg.containerEl.dataset.sidebarPreset = i < aCount ? 'A' : 'B';
			this._knownTabGroups.add(tg);
		}

		rightSplit.containerEl.dataset.activePreset = this.settings.activeSlot;
	}

	// ─── 시작 시 너비 복원 ───

	restoreActiveWidth() {
		const rightSplit = this.app.workspace.rightSplit;
		const active = this.settings.activeSlot;
		const width = this.settings.widths?.[active];

		if (!width) {
			// 최초 실행 — 현재 너비를 활성 프리셋 너비로 저장
			this.settings.widths[active] = rightSplit.containerEl.offsetWidth || 300;
			this.saveData(this.settings);
			return;
		}

		rightSplit.width = width;
		rightSplit.containerEl.style.width = width + 'px';
	}

	// ─── 가시성 ───

	applyVisibility() {
		const rightSplit = this.app.workspace.rightSplit;
		const active = this.settings.activeSlot;

		rightSplit.containerEl.dataset.activePreset = active;

		// 탭 그룹 사이의 리사이즈 핸들만 제어.
		// 양쪽에 프리셋 태그가 있는 핸들만 건드림 — 그 외(사이드바 너비 핸들 등)는 절대 안 건드림.
		const children = [...rightSplit.containerEl.children];
		for (let i = 0; i < children.length; i++) {
			const el = children[i];
			if (!el.classList.contains('workspace-leaf-resize-handle')) continue;

			const prev = this.findNearestTabGroup(children, i, -1);
			const next = this.findNearestTabGroup(children, i, 1);

			// 양쪽 모두 프리셋 태그가 있는 핸들만 제어 (탭 그룹 간 핸들)
			if (!prev?.dataset?.sidebarPreset || !next?.dataset?.sidebarPreset) continue;

			const prevVisible = prev.dataset.sidebarPreset === active;
			const nextVisible = next.dataset.sidebarPreset === active;

			el.style.display = (prevVisible && nextVisible) ? '' : 'none';
		}
	}

	findNearestTabGroup(children, from, dir) {
		for (let i = from + dir; i >= 0 && i < children.length; i += dir) {
			if (children[i].classList.contains('workspace-tabs')) return children[i];
		}
		return null;
	}

	// ─── 새 탭 그룹 감지 (사용자가 뷰를 추가할 때) ───

	tagNewTabGroups() {
		const rightSplit = this.app.workspace.rightSplit;
		const active = this.settings.activeSlot;

		for (const tg of rightSplit.children) {
			if (!this._knownTabGroups.has(tg)) {
				tg.containerEl.dataset.sidebarPreset = active;
				this._knownTabGroups.add(tg);
			}
		}

		// 삭제된 탭 그룹 정리
		for (const tg of this._knownTabGroups) {
			if (!rightSplit.children.includes(tg)) {
				this._knownTabGroups.delete(tg);
			}
		}

		this.applyVisibility();
	}

	// ─── 토글 ───

	toggle() {
		const rightSplit = this.app.workspace.rightSplit;
		const curr = this.settings.activeSlot;
		const next = curr === 'A' ? 'B' : 'A';

		// 현재 너비 저장
		this.settings.widths[curr] = rightSplit.containerEl.offsetWidth || 300;

		// 다음 프리셋에 탭 그룹이 없으면 하나 생성
		const hasNext = rightSplit.children.some(
			tg => tg.containerEl.dataset.sidebarPreset === next,
		);
		if (!hasNext) {
			const newLeaf = this.app.workspace.getRightLeaf(true);
			if (newLeaf?.parent) {
				newLeaf.parent.containerEl.dataset.sidebarPreset = next;
				this._knownTabGroups.add(newLeaf.parent);
			}
		}

		// 전환
		this.settings.activeSlot = next;
		this.applyVisibility();
		this.ensureHeaderButtons();

		// 너비 복원 (트랜지션 포함)
		if (this.settings.widths[next]) {
			const el = rightSplit.containerEl;
			el.classList.add('sidebar-preset-transitioning');
			// 현재 너비를 명시적으로 고정 후 다음 프레임에서 변경 → 트랜지션 트리거
			el.style.width = (this.settings.widths[curr] || el.offsetWidth) + 'px';
			requestAnimationFrame(() => {
				rightSplit.width = this.settings.widths[next];
				el.style.width = this.settings.widths[next] + 'px';
				const cleanup = () => {
					el.classList.remove('sidebar-preset-transitioning');
					el.removeEventListener('transitionend', cleanup);
				};
				el.addEventListener('transitionend', cleanup, { once: true });
				// 폴백: transitionend가 안 올 경우 200ms 후 정리
				setTimeout(cleanup, 120);
			});
		}

		// 그룹 수 저장 (재시작 시 프리셋 복원용)
		this.settings.groupCounts = {
			A: rightSplit.children.filter(tg => tg.containerEl.dataset.sidebarPreset === 'A').length,
			B: rightSplit.children.filter(tg => tg.containerEl.dataset.sidebarPreset === 'B').length,
		};

		this.saveData(this.settings);
		this.app.workspace.requestSaveLayout();
	}

	// ─── UI ───

	/**
	 * 접기 버튼(.sidebar-toggle-button)과 프리셋 버튼을
	 * 현재 활성 프리셋의 첫 번째 탭 그룹 헤더로 이동.
	 *
	 * 접기 버튼은 A의 첫 번째 그룹에만 존재하므로,
	 * B로 전환하면 숨겨진 A 그룹 안에 묻힘 → 직접 옮겨야 함.
	 */
	ensureHeaderButtons() {
		const rightSplit = this.app.workspace.rightSplit;
		const active = this.settings.activeSlot;

		// 활성 프리셋의 첫 번째 탭 그룹 찾기
		const firstVisible = rightSplit.children.find(
			tg => tg.containerEl.dataset.sidebarPreset === active,
		);
		if (!firstVisible) return;

		const targetHeader = firstVisible.containerEl.querySelector(
			'.workspace-tab-header-container',
		);
		if (!targetHeader) return;

		// 1) mod-top 클래스를 활성 프리셋의 첫 번째 그룹으로 이동
		for (const tg of rightSplit.children) {
			tg.containerEl.classList.toggle('mod-top', tg === firstVisible);
		}

		// 2) 접기 버튼을 대상 헤더로 이동
		const sidebarToggle = rightSplit.containerEl.querySelector('.sidebar-toggle-button');
		if (sidebarToggle && sidebarToggle.closest('.workspace-tab-header-container') !== targetHeader) {
			targetHeader.prepend(sidebarToggle);
		}

		// 2) 프리셋 버튼: 기존 것 제거 후 새로 생성
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}

		if (sidebarToggle) {
			const btn = createEl('div', {
				cls: 'sidebar-preset-toggle clickable-icon',
				attr: { 'aria-label': '사이드바 프리셋 전환' },
			});
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.toggle();
			});
			sidebarToggle.after(btn);
			this.toggleBtnEl = btn;
			this.updateButton();
		}
	}

	injectButton() {
		if (this.toggleBtnEl && this.toggleBtnEl.isConnected) return;

		const rightSplit = this.app.workspace.rightSplit;
		if (!rightSplit?.containerEl) return;

		const sidebarToggle = rightSplit.containerEl.querySelector('.sidebar-toggle-button');
		if (!sidebarToggle) return;

		const btn = createEl('div', {
			cls: 'sidebar-preset-toggle clickable-icon',
			attr: { 'aria-label': '사이드바 프리셋 전환' },
		});

		this.registerDomEvent(btn, 'click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			this.toggle();
		});

		sidebarToggle.after(btn);
		this.toggleBtnEl = btn;
		this.updateButton();
	}

	updateButton() {
		if (!this.toggleBtnEl) return;
		const isA = this.settings.activeSlot === 'A';
		this.toggleBtnEl.empty();
		const label = this.toggleBtnEl.createSpan({ cls: 'sidebar-preset-num' });
		label.textContent = isA ? '1' : '2';
		this.toggleBtnEl.setAttribute(
			'aria-label',
			isA ? '프리셋 2로 전환' : '프리셋 1로 전환',
		);
		this.toggleBtnEl.toggleClass('is-custom', !isA);
	}
}

module.exports = SidebarPresetsPlugin;
