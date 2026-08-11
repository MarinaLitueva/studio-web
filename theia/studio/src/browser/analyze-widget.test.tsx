import 'reflect-metadata';
jest.mock('@theia/editor/lib/browser/editor-manager', () => ({
    EditorManager: class EditorManager {}
}));
import * as React from '@theia/core/shared/react';
import { Container } from '@theia/core/shared/inversify';
import { MessageLoop } from '@theia/core/shared/@lumino/messaging';
import { Emitter } from '@theia/core/lib/common';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import type { AnalyzeMetricKey, AnalyzeViewModel } from './analyze-controller';
import { AnalyzeWidget } from './analyze-widget';
import type { AnalyzeFrontendController } from './analyze-controller';

type GaugeLevel = 'Good' | 'Attention' | 'Risk';

type GaugeTrendPoint = {
    readonly date: string;
    readonly value: number;
};

type GaugeMetric = {
    readonly key: AnalyzeMetricKey;
    readonly label: string;
    readonly score: number;
    readonly unit: '%';
    readonly direction: 'higher-better' | 'lower-better';
    readonly level: GaugeLevel;
    readonly definition: string;
    readonly interpretation: string;
    readonly ariaText: string;
    readonly trend: readonly GaugeTrendPoint[];
};

type GaugeAnalyzeViewModel = Omit<AnalyzeViewModel, 'metrics'> & {
    readonly metrics: readonly GaugeMetric[];
};

describe('AnalyzeWidget', () => {
    const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    let previousReactActEnvironment: boolean | undefined;

    beforeAll(() => {
        previousReactActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterAll(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment;
    });

    it('renders five selectable gauges, readiness trend by default, and removes old sparkline/full-chart ids', () => {
        const controller = createController(createCurrentViewModel());
        const widget = mountWidget(controller, 1100);

        expect(widget.node.innerHTML).toContain('data-testid="analyze-widget"');
        expect(widget.node.textContent).toContain('Mock analysis');
        expect(widget.node.textContent).toContain('overview.md');
        expect(widget.node.textContent).toContain('1234');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-gauge-readiness"');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-gauge-gap"');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-gauge-contradiction"');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-gauge-bloat"');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-gauge-checklist"');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-trend-chart"');
        expect(widget.node.innerHTML).not.toContain('data-testid="analyze-chart-full"');
        expect(widget.node.innerHTML).not.toContain('data-testid="analyze-chart-sparkline"');
        expect(widget.node.textContent).toContain('Readiness trend');
        expect(widget.node.textContent).toContain('Date');
        expect(widget.node.textContent).toContain('Score (%)');
        expect(widget.node.textContent).toContain('Higher is better');
        expect(widget.node.textContent).toContain('Lower is better');

        const readinessGauge = widget.node.querySelector('[data-testid="analyze-gauge-readiness"]');
        expect(readinessGauge?.getAttribute('aria-pressed')).toBe('true');
        expect(readinessGauge?.getAttribute('aria-label')).toContain('Readiness');
        expect(readinessGauge?.getAttribute('aria-label')).toContain('82%');
        expect(readinessGauge?.getAttribute('aria-label')).toContain('Higher is better');
        expect(readinessGauge?.getAttribute('aria-label')).toContain('Good');

        disposeWidget(widget);
    });

    it('renders dated axis labels, score ticks, and exact accessible point values for the selected trend', () => {
        const controller = createController(createCurrentViewModel());
        const widget = mountWidget(controller, 1100);

        expect(widget.node.textContent).toContain('0');
        expect(widget.node.textContent).toContain('25');
        expect(widget.node.textContent).toContain('50');
        expect(widget.node.textContent).toContain('75');
        expect(widget.node.textContent).toContain('100');
        expect(widget.node.textContent).toContain('2026-05-12');
        expect(widget.node.textContent).toContain('2026-05-26');
        expect(widget.node.textContent).toContain('2026-06-09');
        expect(widget.node.textContent).toContain('2026-06-23');
        expect(widget.node.textContent).toContain('2026-07-07');
        expect(widget.node.textContent).toContain('2026-07-21');
        expect(widget.node.innerHTML).toContain('data-testid="analyze-trend-point-readiness-2026-07-28"');

        const exactPoint = widget.node.querySelector('[data-testid="analyze-trend-point-readiness-2026-07-28"]');
        expect(exactPoint?.getAttribute('aria-label')).toBe('Readiness on 2026-07-28: 82%');

        disposeWidget(widget);
    });

    it('switches from wide vertical gauges to narrow horizontal gauges while keeping metric text visible', () => {
        const controller = createController(createCurrentViewModel());
        const widget = mountWidget(controller, 1100);

        expect(widget.node.querySelector('[data-testid="analyze-gauge-readiness"]')?.getAttribute('data-orientation')).toBe('vertical');
        expect(widget.node.textContent).toContain('Actionability of the current document.');
        expect(widget.node.textContent).toContain('Strong readiness across the last 12 weekly checkpoints.');

        setWidgetWidth(widget, 360);
        React.act(() => {
            MessageLoop.sendMessage(widget, new Widget.ResizeMessage(360, 700));
            MessageLoop.flush();
        });

        expect(widget.node.querySelector('[data-testid="analyze-gauge-readiness"]')?.getAttribute('data-orientation')).toBe('horizontal');
        expect(widget.node.textContent).toContain('Actionability of the current document.');
        expect(widget.node.textContent).toContain('Strong readiness across the last 12 weekly checkpoints.');

        disposeWidget(widget);
    });

    it('changes the trend panel when a different gauge is selected', async () => {
        const controller = createController(createCurrentViewModel());
        const widget = mountWidget(controller, 1100);

        expect(widget.node.textContent).toContain('Readiness trend');

        const checklistGauge = widget.node.querySelector('[data-testid="analyze-gauge-checklist"]') as HTMLButtonElement | null;
        expect(checklistGauge).not.toBeNull();

        await React.act(async () => {
            checklistGauge?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(widget.node.textContent).toContain('Checklist trend');
        expect(widget.node.querySelector('[data-testid="analyze-gauge-checklist"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(widget.node.querySelector('[data-testid="analyze-trend-point-checklist-2026-07-28"]')?.getAttribute('aria-label')).toBe('Checklist on 2026-07-28: 91%');

        disposeWidget(widget);
    });

    it('reflects stale and loading states and invokes analyze from the action button', async () => {
        const controller = createController(createStaleViewModel());
        const widget = mountWidget(controller, 960);

        expect(widget.node.textContent).toContain('Stale');

        const analyzeButton = widget.node.querySelector('[data-testid="analyze-run"]') as HTMLButtonElement | null;
        expect(analyzeButton).not.toBeNull();

        await React.act(async () => {
            analyzeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(controller.analyze).toHaveBeenCalledTimes(1);

        React.act(() => {
            controller.setViewModel(createLoadingViewModel());
            MessageLoop.flush();
        });
        expect(widget.node.textContent).toContain('Loading mock analysis');

        React.act(() => {
            controller.setViewModel(createCurrentViewModel());
            MessageLoop.flush();
        });
        expect(widget.node.textContent).toContain('Current');

        disposeWidget(widget);
    });

    it('is focusable and takes focus on activate request', () => {
        const controller = createController(createCurrentViewModel());
        const widget = mountWidget(controller, 960);

        expect(widget.node.tabIndex).toBe(0);
        expect(document.activeElement).not.toBe(widget.node);

        React.act(() => {
            MessageLoop.sendMessage(widget, Widget.Msg.ActivateRequest);
            MessageLoop.flush();
        });

        expect(document.activeElement).toBe(widget.node);

        disposeWidget(widget);
    });

    it('renders an honest empty state when no active document is available', () => {
        const controller = createController({
            status: 'empty',
            analysisLabel: 'Mock analysis',
            emptyStateTitle: 'No active text document',
            emptyStateDescription: 'Open a text editor to inspect mock analysis.',
            metrics: [],
            tokenUsage: 0
        } as GaugeAnalyzeViewModel);
        const widget = mountWidget(controller, 960);

        expect(widget.node.innerHTML).toContain('data-testid="analyze-empty-state"');
        expect(widget.node.textContent).toContain('No active text document');
        expect(widget.node.textContent).toContain('Open a text editor to inspect mock analysis.');

        disposeWidget(widget);
    });
});

function mountWidget(controller: ReturnType<typeof createController>, width: number): AnalyzeWidget {
    const container = new Container();
    container.bind(AnalyzeWidget).toSelf();
    container.bind<AnalyzeFrontendController>(Symbol.for('AnalyzeFrontendController')).toConstantValue(controller as never);
    container.bind(require('./analyze-controller').AnalyzeFrontendController).toConstantValue(controller as never);
    let widget: AnalyzeWidget;
    React.act(() => {
        widget = container.resolve(AnalyzeWidget);
        document.body.appendChild(widget!.node);
        setWidgetWidth(widget!, width);
        widget!.update();
        MessageLoop.flush();
    });
    return widget!;
}

function setWidgetWidth(widget: AnalyzeWidget, width: number): void {
    Object.defineProperty(widget.node, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ width, height: 480, top: 0, left: 0, bottom: 480, right: width, x: 0, y: 0, toJSON: () => undefined })
    });
}

function disposeWidget(widget: AnalyzeWidget): void {
    React.act(() => {
        widget.node.remove();
        widget.dispose();
        MessageLoop.flush();
    });
}

function createController(initialViewModel: GaugeAnalyzeViewModel) {
    const onDidChangeEmitter = new Emitter<void>();
    let viewModel = initialViewModel;
    return {
        analyze: jest.fn().mockResolvedValue(undefined),
        onDidChange: onDidChangeEmitter.event,
        getViewModel: () => viewModel as unknown as AnalyzeViewModel,
        setViewModel: (next: GaugeAnalyzeViewModel) => {
            viewModel = next;
            onDidChangeEmitter.fire();
        }
    };
}

function createCurrentViewModel(): GaugeAnalyzeViewModel {
    return {
        status: 'current',
        analysisLabel: 'Mock analysis',
        documentLabel: 'overview.md',
        documentUri: 'file:///workspace/overview.md',
        analyzedAt: '2026-07-28T09:05:00.000Z',
        tokenUsage: 1234,
        metrics: [
            createGaugeMetric('readiness', 'Readiness', 82, 'higher-better', 'Good', 'Actionability of the current document.', 'Strong readiness across the last 12 weekly checkpoints.', [46, 52, 58, 61, 66, 69, 72, 74, 76, 79, 81, 82]),
            createGaugeMetric('gap', 'Gap', 24, 'lower-better', 'Good', 'Distance between the current draft and expected coverage.', 'Coverage gaps are limited and still trending down.', [51, 49, 46, 43, 40, 37, 34, 31, 29, 27, 25, 24]),
            createGaugeMetric('contradiction', 'Contradiction', 18, 'lower-better', 'Good', 'Conflict pressure between claims in the document.', 'Contradictions are low and continue to fall.', [39, 36, 34, 31, 29, 27, 25, 23, 22, 20, 19, 18]),
            createGaugeMetric('bloat', 'Bloat', 27, 'lower-better', 'Attention', 'Amount of excess material relative to the stated scope.', 'Bloat is improving but still above the good threshold.', [47, 44, 41, 39, 37, 35, 33, 32, 31, 30, 28, 27]),
            createGaugeMetric('checklist', 'Checklist', 91, 'higher-better', 'Good', 'Completion of explicit review and delivery criteria.', 'Checklist completion is consistently strong.', [62, 66, 69, 72, 75, 78, 81, 84, 86, 88, 90, 91])
        ]
    };
}

function createStaleViewModel(): GaugeAnalyzeViewModel {
    return {
        ...createCurrentViewModel(),
        status: 'stale'
    };
}

function createLoadingViewModel(): GaugeAnalyzeViewModel {
    return {
        ...createCurrentViewModel(),
        status: 'loading'
    };
}

function createGaugeMetric(
    key: AnalyzeMetricKey,
    label: string,
    score: number,
    direction: 'higher-better' | 'lower-better',
    level: GaugeLevel,
    definition: string,
    interpretation: string,
    values: readonly number[]
): GaugeMetric {
    const trend = values.map((value, index) => ({
        date: buildWeeklyDate(index),
        value
    }));
    return {
        key,
        label,
        score,
        unit: '%',
        direction,
        level,
        definition,
        interpretation,
        ariaText: `${label}: ${score}% (${level}). ${direction === 'higher-better' ? 'Higher is better.' : 'Lower is better.'} ${definition} ${interpretation}`,
        trend
    };
}

function buildWeeklyDate(index: number): string {
    const dates = [
        '2026-05-12',
        '2026-05-19',
        '2026-05-26',
        '2026-06-02',
        '2026-06-09',
        '2026-06-16',
        '2026-06-23',
        '2026-06-30',
        '2026-07-07',
        '2026-07-14',
        '2026-07-21',
        '2026-07-28'
    ] as const;
    return dates[index] ?? dates[dates.length - 1];
}
