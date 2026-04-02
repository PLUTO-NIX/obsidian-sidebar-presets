'use strict';

const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
	maxPages: 2,
	activePage: 1,
	pageConfigs: {},
};

function defaultPageConfig(pageNum) {
	return {
		loadStrategy: pageNum === 1 ? 'preload' : 'ondemand',
		width: null,
		groupCount: 0,
		serialized: null,
	};
}

/**
 * Sidebar Presets v2
 *
 * 우측 사이드바 레이아웃을 최대 9개 프리셋 페이지로 관리.
 * - 페이지 1: 기본 사이드바 (삭제 불가, 항상 preload)
 * - 페이지 2~9: 설정에서 추가, per-page 로딩 전략
 *   - preload: visibility:hidden, 즉시 전환, 스크롤 보존
 *   - ondemand: 전환 시 직렬화/역직렬화, 메모리 절약
 */
class SidebarPresetsPlugin extends obsidian.Plugin {

	async onload() {
		await this.loadSettings();
		this.toggleBtnEl = null;
		this._knownTabGroups = new Set();
		this._wasCollapsed = false;
		this._switching = false;

		// 커맨드: 이전/다음 프리셋
		this.addCommand({
			id: 'prev-preset',
			name: '이전 프리셋',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '[' }],
			callback: () => this.prevPage(),
		});
		this.addCommand({
			id: 'next-preset',
			name: '다음 프리셋',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: ']' }],
			callback: () => this.nextPage(),
		});

		// 설정 탭
		this.addSettingTab(new SidebarPresetsSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.initPresets();
			this.applyVisibility();
			this.restoreActiveWidth();
			this.ensureHeaderButtons();
		});

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.tagNewTabGroups();

				const rightSplit = this.app.workspace.rightSplit;
				const isCollapsed = rightSplit.collapsed;
				if (this._wasCollapsed && !isCollapsed) {
					const cfg = this.getPageConfig(this.settings.activePage);
					if (cfg.width) {
						rightSplit.width = cfg.width;
						rightSplit.containerEl.style.width = cfg.width + 'px';
					}
				}
				this._wasCollapsed = isCollapsed;

				if (!this.toggleBtnEl || !this.toggleBtnEl.isConnected) {
					this.ensureHeaderButtons();
				}
			}),
		);
	}

	onunload() {
		const rightSplit = this.app.workspace.rightSplit;
		if (rightSplit?.containerEl) {
			delete rightSplit.containerEl.dataset.activePreset;
			for (const tg of rightSplit.children) {
				delete tg.containerEl.dataset.sidebarPreset;
				tg.containerEl.classList.remove('sidebar-preset-inactive');
			}
			for (const el of rightSplit.containerEl.children) {
				if (el.classList.contains('workspace-leaf-resize-handle')) {
					el.style.display = '';
				}
			}
		}
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}
	}

	// ─── 설정 ───

	async loadSettings() {
		const raw = await this.loadData();
		if (raw && raw.activeSlot) {
			// v1(A/B) → v2 마이그레이션
			this.settings = this.migrateV1(raw);
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		}
		// 페이지 1은 항상 존재
		if (!this.settings.pageConfigs[1]) {
			this.settings.pageConfigs[1] = defaultPageConfig(1);
		}
	}

	migrateV1(old) {
		const s = Object.assign({}, DEFAULT_SETTINGS);
		s.activePage = old.activeSlot === 'B' ? 2 : 1;
		s.maxPages = 2;
		s.pageConfigs[1] = {
			loadStrategy: 'preload',
			width: old.widths?.A || null,
			groupCount: old.groupCounts?.A || 0,
			serialized: null,
		};
		s.pageConfigs[2] = {
			loadStrategy: 'ondemand',
			width: old.widths?.B || null,
			groupCount: old.groupCounts?.B || 0,
			serialized: null,
		};
		return s;
	}

	getPageConfig(pageNum) {
		if (!this.settings.pageConfigs[pageNum]) {
			this.settings.pageConfigs[pageNum] = defaultPageConfig(pageNum);
		}
		return this.settings.pageConfigs[pageNum];
	}

	// ─── 초기화 ───

	initPresets() {
		const rightSplit = this.app.workspace.rightSplit;
		const children = rightSplit.children;

		// 기존 탭 그룹을 페이지별로 배분
		let idx = 0;
		for (let p = 1; p <= this.settings.maxPages; p++) {
			const cfg = this.getPageConfig(p);
			if (cfg.loadStrategy === 'preload' && cfg.groupCount > 0) {
				for (let g = 0; g < cfg.groupCount && idx < children.length; g++, idx++) {
					children[idx].containerEl.dataset.sidebarPreset = String(p);
					this._knownTabGroups.add(children[idx]);
				}
			}
		}
		// 남은 탭 그룹은 페이지 1에 할당
		while (idx < children.length) {
			children[idx].containerEl.dataset.sidebarPreset = '1';
			this._knownTabGroups.add(children[idx]);
			idx++;
		}

		rightSplit.containerEl.dataset.activePreset = String(this.settings.activePage);
	}

	// ─── 너비 ───

	restoreActiveWidth() {
		const rightSplit = this.app.workspace.rightSplit;
		const cfg = this.getPageConfig(this.settings.activePage);

		if (!cfg.width) {
			cfg.width = rightSplit.containerEl.offsetWidth || 300;
			this.saveData(this.settings);
			return;
		}

		rightSplit.width = cfg.width;
		rightSplit.containerEl.style.width = cfg.width + 'px';
	}

	// ─── 가시성 ───

	applyVisibility() {
		const rightSplit = this.app.workspace.rightSplit;
		const active = String(this.settings.activePage);

		rightSplit.containerEl.dataset.activePreset = active;

		// 탭 그룹 가시성 (클래스 기반)
		for (const tg of rightSplit.children) {
			const preset = tg.containerEl.dataset.sidebarPreset;
			if (!preset) continue;
			const isActive = preset === active;
			tg.containerEl.classList.toggle('sidebar-preset-inactive', !isActive);
		}

		// 리사이즈 핸들 제어
		const children = [...rightSplit.containerEl.children];
		for (let i = 0; i < children.length; i++) {
			const el = children[i];
			if (!el.classList.contains('workspace-leaf-resize-handle')) continue;

			const prev = this.findNearestTabGroup(children, i, -1);
			const next = this.findNearestTabGroup(children, i, 1);

			if (!prev?.dataset?.sidebarPreset || !next?.dataset?.sidebarPreset) continue;

			const prevActive = prev.dataset.sidebarPreset === active;
			const nextActive = next.dataset.sidebarPreset === active;

			el.style.display = (prevActive && nextActive) ? '' : 'none';
		}
	}

	findNearestTabGroup(children, from, dir) {
		for (let i = from + dir; i >= 0 && i < children.length; i += dir) {
			if (children[i].classList.contains('workspace-tabs')) return children[i];
		}
		return null;
	}

	// ─── 새 탭 그룹 감지 ───

	tagNewTabGroups() {
		if (this._switching) return;
		const rightSplit = this.app.workspace.rightSplit;
		const active = String(this.settings.activePage);

		for (const tg of rightSplit.children) {
			if (!this._knownTabGroups.has(tg)) {
				tg.containerEl.dataset.sidebarPreset = active;
				this._knownTabGroups.add(tg);
			}
		}

		for (const tg of this._knownTabGroups) {
			if (!rightSplit.children.includes(tg)) {
				this._knownTabGroups.delete(tg);
			}
		}

		this.applyVisibility();
	}

	// ─── On-demand 직렬화 ───

	capturePageState(pageNum) {
		const rightSplit = this.app.workspace.rightSplit;
		const tag = String(pageNum);
		const groups = [];

		for (const tg of rightSplit.children) {
			if (tg.containerEl.dataset.sidebarPreset !== tag) continue;
			if (!tg.children) continue;
			const leaves = [];
			for (const leaf of tg.children) {
				const vs = leaf.getViewState();
				leaves.push({
					type: vs.type,
					state: vs.state || {},
					pinned: vs.pinned || false,
				});
			}
			if (leaves.length === 0) continue;
			groups.push({ dimension: tg.dimension, leaves });
		}

		return groups.length > 0 ? { groups } : null;
	}

	async restorePageState(pageNum) {
		const cfg = this.getPageConfig(pageNum);
		const preset = cfg.serialized;
		if (!preset || !preset.groups || preset.groups.length === 0) return;

		const rightSplit = this.app.workspace.rightSplit;
		const tag = String(pageNum);

		for (let gi = 0; gi < preset.groups.length; gi++) {
			const groupData = preset.groups[gi];
			if (!groupData.leaves || groupData.leaves.length === 0) continue;

			for (let li = 0; li < groupData.leaves.length; li++) {
				const leafData = groupData.leaves[li];
				let newLeaf;

				if (li === 0) {
					// 항상 새 탭 그룹 생성 (기존 그룹 재사용 금지)
					newLeaf = this.app.workspace.getRightLeaf(true);
				} else {
					const tabGroup = rightSplit.children[rightSplit.children.length - 1];
					if (tabGroup) {
						newLeaf = this.app.workspace.createLeafInParent(tabGroup, li);
					}
				}

				if (newLeaf) {
					await newLeaf.setViewState({
						type: leafData.type,
						state: leafData.state,
						pinned: leafData.pinned,
					});
					// 새로 생성된 리프의 탭 그룹에 프리셋 태그
					if (newLeaf.parent?.containerEl) {
						newLeaf.parent.containerEl.dataset.sidebarPreset = tag;
						this._knownTabGroups.add(newLeaf.parent);
					}
				}
			}

			// dimension 복원
			const lastTg = rightSplit.children[rightSplit.children.length - 1];
			if (groupData.dimension != null && lastTg) {
				lastTg.dimension = groupData.dimension;
			}
		}
	}

	clearPageGroups(pageNum) {
		const rightSplit = this.app.workspace.rightSplit;
		const tag = String(pageNum);
		const leaves = [];

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.getRoot() === rightSplit) {
				const tg = leaf.parent;
				if (tg?.containerEl?.dataset?.sidebarPreset === tag) {
					leaves.push(leaf);
				}
			}
		});

		for (const leaf of leaves) {
			leaf.detach();
		}

		// 빈 탭 그룹 정리
		for (const tg of [...rightSplit.children]) {
			if (tg.containerEl.dataset.sidebarPreset === tag) {
				this._knownTabGroups.delete(tg);
			}
		}
	}

	// ─── 페이지 전환 ───

	nextPage() {
		const next = this.settings.activePage >= this.settings.maxPages
			? 1
			: this.settings.activePage + 1;
		this.switchToPage(next);
	}

	prevPage() {
		const prev = this.settings.activePage <= 1
			? this.settings.maxPages
			: this.settings.activePage - 1;
		this.switchToPage(prev);
	}

	async switchToPage(pageNum) {
		if (pageNum === this.settings.activePage) return;
		if (pageNum < 1 || pageNum > this.settings.maxPages) return;
		if (this._switching) return;
		this._switching = true;

		try {
		const rightSplit = this.app.workspace.rightSplit;
		const currPage = this.settings.activePage;
		const currCfg = this.getPageConfig(currPage);
		const nextCfg = this.getPageConfig(pageNum);

		// 1) 현재 페이지 너비 저장
		currCfg.width = rightSplit.containerEl.offsetWidth || 300;

		// 2) 현재 페이지 비활성화
		if (currCfg.loadStrategy === 'ondemand') {
			currCfg.serialized = this.capturePageState(currPage);
			this.clearPageGroups(currPage);
		}

		// 3) groupCount 갱신
		this.updateGroupCounts();

		// 4) 다음 페이지 활성화
		if (nextCfg.loadStrategy === 'ondemand') {
			await this.restorePageState(pageNum);
		}

		// 5) 빈 페이지면 탭 그룹 하나 생성
		const tag = String(pageNum);
		const hasGroups = rightSplit.children.some(
			tg => tg.containerEl.dataset.sidebarPreset === tag,
		);
		if (!hasGroups) {
			const newLeaf = this.app.workspace.getRightLeaf(true);
			if (newLeaf?.parent) {
				newLeaf.parent.containerEl.dataset.sidebarPreset = tag;
				this._knownTabGroups.add(newLeaf.parent);
			}
		}

		// 6) 가시성 적용 + 헤더 버튼
		this.settings.activePage = pageNum;
		this.applyVisibility();
		this.ensureHeaderButtons();

		// 7) 너비 전환 (rAF 기반, 논블로킹)
		this.transitionWidth(currCfg.width, nextCfg.width);

		// 8) 저장 (비동기, 백그라운드)
		this.updateGroupCounts();
		this.saveData(this.settings);
		this.app.workspace.requestSaveLayout();
		} finally {
			this._switching = false;
		}
	}

	transitionWidth(fromWidth, toWidth) {
		const rightSplit = this.app.workspace.rightSplit;
		const el = rightSplit.containerEl;

		rightSplit.width = toWidth || fromWidth;

		// 즉시 전환 (CSS 트랜지션 없음 — reflow 1회만)
		if (toWidth) {
			el.style.width = toWidth + 'px';
		}
	}

	updateGroupCounts() {
		const rightSplit = this.app.workspace.rightSplit;
		for (let p = 1; p <= this.settings.maxPages; p++) {
			const cfg = this.getPageConfig(p);
			if (cfg.loadStrategy === 'preload') {
				cfg.groupCount = rightSplit.children.filter(
					tg => tg.containerEl.dataset.sidebarPreset === String(p),
				).length;
			}
		}
	}

	// ─── 페이지 개요 (설정 탭용) ───

	getPageOverview(pageNum) {
		const cfg = this.getPageConfig(pageNum);
		const tag = String(pageNum);
		const viewNames = [];

		if (cfg.loadStrategy === 'preload' || pageNum === this.settings.activePage) {
			// DOM에서 직접 읽기
			const rightSplit = this.app.workspace.rightSplit;
			for (const tg of rightSplit.children) {
				if (tg.containerEl.dataset.sidebarPreset !== tag) continue;
				for (const leaf of tg.children) {
					const vs = leaf.getViewState();
					viewNames.push(vs.type || 'unknown');
				}
			}
		} else if (cfg.serialized?.groups) {
			// 직렬화 데이터에서 읽기
			for (const g of cfg.serialized.groups) {
				for (const l of g.leaves) {
					viewNames.push(l.type || 'unknown');
				}
			}
		}

		return viewNames.length > 0 ? viewNames.join(', ') : '(비어 있음)';
	}

	// ─── 페이지 삭제 ───

	async deletePage(pageNum) {
		if (pageNum === 1) return;
		if (pageNum === this.settings.activePage) {
			await this.switchToPage(1);
		}

		const cfg = this.getPageConfig(pageNum);
		if (cfg.loadStrategy === 'preload') {
			this.clearPageGroups(pageNum);
		}

		delete this.settings.pageConfigs[pageNum];
		await this.saveData(this.settings);
	}

	// ─── UI ───

	ensureHeaderButtons() {
		const rightSplit = this.app.workspace.rightSplit;
		const active = String(this.settings.activePage);

		const firstVisible = rightSplit.children.find(
			tg => tg.containerEl.dataset.sidebarPreset === active,
		);
		if (!firstVisible) return;

		const targetHeader = firstVisible.containerEl.querySelector(
			'.workspace-tab-header-container',
		);
		if (!targetHeader) return;

		// mod-top
		for (const tg of rightSplit.children) {
			tg.containerEl.classList.toggle('mod-top', tg === firstVisible);
		}

		// 접기 버튼 이동
		const sidebarToggle = rightSplit.containerEl.querySelector('.sidebar-toggle-button');
		if (sidebarToggle && sidebarToggle.closest('.workspace-tab-header-container') !== targetHeader) {
			targetHeader.prepend(sidebarToggle);
		}

		// 프리셋 버튼
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}

		if (targetHeader) {
			const btn = createEl('div', {
				cls: 'sidebar-preset-toggle clickable-icon',
				attr: { 'aria-label': '사이드바 프리셋 전환' },
			});
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.nextPage();
			});
			// 헤더 맨 앞에 배치 (창모드에서 우측 접기 버튼이 가려져도 항상 보임)
			targetHeader.prepend(btn);
			this.toggleBtnEl = btn;
			this.updateButton();
		}
	}

	updateButton() {
		if (!this.toggleBtnEl) return;
		const page = this.settings.activePage;
		this.toggleBtnEl.empty();
		const label = this.toggleBtnEl.createSpan({ cls: 'sidebar-preset-num' });
		label.textContent = String(page);
		this.toggleBtnEl.setAttribute('aria-label', '프리셋 ' + page + '/' + this.settings.maxPages);
		this.toggleBtnEl.toggleClass('is-custom', page !== 1);
	}
}

// ─── 설정 탭 ───

class SidebarPresetsSettingTab extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Sidebar Presets' });

		// 최대 페이지 수
		new obsidian.Setting(containerEl)
			.setName('최대 페이지 수')
			.setDesc('우측 사이드바 프리셋 페이지 수 (1~9)')
			.addSlider((slider) =>
				slider
					.setLimits(1, 9, 1)
					.setValue(this.plugin.settings.maxPages)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxPages = value;
						await this.plugin.saveData(this.plugin.settings);
						this.display(); // 목록 갱신
					}),
			);

		// 페이지별 설정
		for (let p = 1; p <= this.plugin.settings.maxPages; p++) {
			const cfg = this.plugin.getPageConfig(p);
			const overview = this.plugin.getPageOverview(p);
			const isPage1 = p === 1;

			containerEl.createEl('h3', {
				text: '페이지 ' + p + (isPage1 ? ' (기본)' : ''),
			});

			// 개요
			new obsidian.Setting(containerEl)
				.setName('저장된 뷰')
				.setDesc(overview);

			// 로딩 전략 (페이지 1은 항상 preload)
			if (!isPage1) {
				new obsidian.Setting(containerEl)
					.setName('로딩 방식')
					.setDesc('프리로드: 즉시 전환, 스크롤 유지 / 온디맨드: 메모리 절약')
					.addDropdown((dropdown) =>
						dropdown
							.addOption('preload', '프리로드')
							.addOption('ondemand', '온디맨드')
							.setValue(cfg.loadStrategy)
							.onChange(async (value) => {
								cfg.loadStrategy = value;
								await this.plugin.saveData(this.plugin.settings);
							}),
					);

				// 삭제
				new obsidian.Setting(containerEl)
					.setName('페이지 삭제')
					.setDesc('이 페이지의 저장 데이터를 삭제합니다')
					.addButton((btn) =>
						btn
							.setButtonText('삭제')
							.setWarning()
							.onClick(async () => {
								await this.plugin.deletePage(p);
								this.display();
							}),
					);
			}
		}
	}
}

module.exports = SidebarPresetsPlugin;
