import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Message, Widget } from '@theia/core/lib/browser/widgets/widget';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ANALYZE_WIDGET_ID, AnalyzeFrontendController, AnalyzeMetric, AnalyzeMetricKey, AnalyzeTrendPoint, AnalyzeViewModel } from './analyze-controller';

const COMPACT_WIDTH = 480;
const CHART_WIDTH = 560;
const CHART_HEIGHT = 260;
const CHART_PADDING = { top: 22, right: 24, bottom: 52, left: 56 };
const Y_TICKS = [0, 25, 50, 75, 100] as const;

@injectable()
export class AnalyzeWidget extends ReactWidget {
    static readonly ID = ANALYZE_WIDGET_ID;
    static readonly LABEL = 'Analyze';

    @inject(AnalyzeFrontendController)
    protected readonly controller!: AnalyzeFrontendController;
    protected compactLayout = false;
    protected selectedMetricKey: AnalyzeMetricKey = 'readiness';

    @postConstruct()
    protected init(): void {
        this.id = AnalyzeWidget.ID;
        this.title.label = AnalyzeWidget.LABEL;
        this.title.caption = AnalyzeWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-graph';
        this.node.tabIndex = 0;
        this.toDispose.push(this.controller.onDidChange(() => this.update()));
        this.compactLayout = this.isCompact();
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected override onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        const nextCompactLayout = this.isCompact();
        if (nextCompactLayout !== this.compactLayout) {
            this.compactLayout = nextCompactLayout;
            this.update();
        }
    }

    protected override onUpdateRequest(msg: Message): void {
        this.compactLayout = this.isCompact();
        super.onUpdateRequest(msg);
    }

    protected render(): React.ReactNode {
        const model = this.controller.getViewModel();
        return (
            <div className='studio-analyze' data-testid='analyze-widget'>
                <header className='studio-analyze__header'>
                    <div>
                        <div className='studio-analyze__eyebrow'>{model.analysisLabel}</div>
                        <h2 className='studio-analyze__title'>Document analysis overview</h2>
                    </div>
                    <button
                        className='theia-button studio-analyze__action'
                        data-testid='analyze-run'
                        onClick={() => void this.controller.analyze()}
                    >
                        Analyze
                    </button>
                </header>
                {this.renderStatusRow(model)}
                {model.status === 'empty' ? this.renderEmptyState(model) : this.renderDashboard(model, this.compactLayout)}
            </div>
        );
    }

    protected renderStatusRow(model: AnalyzeViewModel): React.ReactNode {
        const statusLabel = this.getStatusLabel(model.status);
        const loadingMessage = model.status === 'loading' ? 'Loading mock analysis' : undefined;
        return (
            <div className='studio-analyze__status-row'>
                <span className={`studio-analyze__badge studio-analyze__badge--${model.status}`}>{statusLabel}</span>
                <span className='studio-analyze__meta' data-testid='analyze-token-usage'>Token usage: {model.tokenUsage}</span>
                {model.analyzedAt ? <span className='studio-analyze__meta'>Analyzed at {model.analyzedAt}</span> : undefined}
                {loadingMessage ? <span className='studio-analyze__meta'>{loadingMessage}</span> : undefined}
            </div>
        );
    }

    protected renderEmptyState(model: AnalyzeViewModel): React.ReactNode {
        return (
            <section className='studio-analyze__empty' data-testid='analyze-empty-state'>
                <h3>{model.emptyStateTitle}</h3>
                <p>{model.emptyStateDescription}</p>
            </section>
        );
    }

    protected renderDashboard(model: AnalyzeViewModel, compact: boolean): React.ReactNode {
        const selectedMetric = this.getSelectedMetric(model.metrics);
        return (
            <div className='studio-analyze__body'>
                <section className='studio-analyze__document'>
                    <div className='studio-analyze__document-label'>Active document</div>
                    <div className='studio-analyze__document-name'>{model.documentLabel}</div>
                    <div className='studio-analyze__document-uri'>{model.documentUri}</div>
                </section>
                <section className='studio-analyze__chart-panel'>
                    <div className='studio-analyze__chart-header'>
                        <h3>{selectedMetric.label} trend</h3>
                        <span className='studio-analyze__meta'>Mock 12-week trend projection</span>
                    </div>
                    {this.renderTrendChart(selectedMetric)}
                </section>
                <section className='studio-analyze__metrics'>
                    {model.metrics.map(metric => this.renderMetricCard(metric, compact, metric.key === selectedMetric.key))}
                </section>
            </div>
        );
    }

    protected renderMetricCard(metric: AnalyzeMetric, compact: boolean, selected: boolean): React.ReactNode {
        const orientation = compact ? 'horizontal' : 'vertical';
        const fillStyle = { [compact ? 'width' : 'height']: `${metric.score}%` };
        return (
            <button
                key={metric.key}
                type='button'
                className={`studio-analyze__metric studio-analyze__metric-button${selected ? ' studio-analyze__metric--selected' : ''}`}
                data-testid={`analyze-gauge-${metric.key}`}
                data-orientation={orientation}
                aria-pressed={selected}
                aria-label={metric.ariaText}
                onClick={() => this.selectMetric(metric.key)}
            >
                <div className='studio-analyze__metric-main'>
                    <div className='studio-analyze__metric-top'>
                        <div>
                            <h3>{metric.label}</h3>
                            <div className='studio-analyze__metric-direction'>
                                {metric.direction === 'higher-better' ? 'Higher is better' : 'Lower is better'}
                            </div>
                        </div>
                        <div className='studio-analyze__metric-summary'>
                            <span className='studio-analyze__metric-score'>{metric.score}{metric.unit}</span>
                            <span className={`studio-analyze__metric-level studio-analyze__metric-level--${metric.level.toLowerCase()}`}>{metric.level}</span>
                        </div>
                    </div>
                    <div className={`studio-analyze__gauge studio-analyze__gauge--${orientation}`} aria-hidden='true'>
                        <div className='studio-analyze__gauge-track'>
                            <div className={`studio-analyze__gauge-fill studio-analyze__gauge-fill--${metric.level.toLowerCase()}`} style={fillStyle} />
                        </div>
                        <div className='studio-analyze__gauge-scale'>
                            <span>0</span>
                            <span>50</span>
                            <span>100</span>
                        </div>
                    </div>
                </div>
                <div className='studio-analyze__metric-copy'>
                    <p className='studio-analyze__metric-definition'>{metric.definition}</p>
                    <p className='studio-analyze__metric-interpretation'>{metric.interpretation}</p>
                </div>
            </button>
        );
    }

    protected renderTrendChart(metric: AnalyzeMetric): React.ReactNode {
        const chartAreaWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
        const chartAreaHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
        const xForIndex = (index: number): number => CHART_PADDING.left + (metric.trend.length <= 1 ? 0 : (chartAreaWidth / (metric.trend.length - 1)) * index);
        const yForValue = (value: number): number => CHART_PADDING.top + chartAreaHeight - (value / 100) * chartAreaHeight;
        return (
            <svg
                className='studio-analyze__chart'
                data-testid='analyze-trend-chart'
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role='img'
                aria-label={`${metric.label} trend`}
            >
                <rect x='0' y='0' width={CHART_WIDTH} height={CHART_HEIGHT} rx='18' className='studio-analyze__chart-surface' />
                {Y_TICKS.map(tick => (
                    <g key={tick}>
                        <line
                            x1={CHART_PADDING.left}
                            x2={CHART_WIDTH - CHART_PADDING.right}
                            y1={yForValue(tick)}
                            y2={yForValue(tick)}
                            className='studio-analyze__chart-grid'
                        />
                        <text x={CHART_PADDING.left - 10} y={yForValue(tick) + 4} className='studio-analyze__chart-axis-label studio-analyze__chart-axis-label--y'>
                            {tick}
                        </text>
                    </g>
                ))}
                <text x={CHART_WIDTH / 2} y={CHART_HEIGHT - 8} className='studio-analyze__chart-axis-title'>Date</text>
                <text
                    x='18'
                    y={CHART_HEIGHT / 2}
                    transform={`rotate(-90 18 ${CHART_HEIGHT / 2})`}
                    className='studio-analyze__chart-axis-title'
                >
                    Score (%)
                </text>
                <polyline
                    fill='none'
                    points={this.buildPolylinePoints(metric.trend, xForIndex, yForValue)}
                    className={`studio-analyze__chart-line studio-analyze__chart-line--${metric.level.toLowerCase()}`}
                />
                {metric.trend.map((point, index) => (
                    <g key={point.date}>
                        {index % 2 === 0 ? (
                            <text x={xForIndex(index)} y={CHART_HEIGHT - 26} className='studio-analyze__chart-axis-label studio-analyze__chart-axis-label--x'>
                                {point.date}
                            </text>
                        ) : undefined}
                        <circle
                            cx={xForIndex(index)}
                            cy={yForValue(point.value)}
                            r='5'
                            className={`studio-analyze__chart-dot studio-analyze__chart-dot--${metric.level.toLowerCase()}`}
                            data-testid={`analyze-trend-point-${metric.key}-${point.date}`}
                            aria-label={`${metric.label} on ${point.date}: ${point.value}%`}
                            tabIndex={0}
                        >
                            <title>{metric.label} on {point.date}: {point.value}%</title>
                        </circle>
                    </g>
                ))}
            </svg>
        );
    }

    protected getSelectedMetric(metrics: readonly AnalyzeMetric[]): AnalyzeMetric {
        return metrics.find(metric => metric.key === this.selectedMetricKey)
            ?? metrics.find(metric => metric.key === 'readiness')
            ?? metrics[0];
    }

    protected selectMetric(metricKey: AnalyzeMetricKey): void {
        if (this.selectedMetricKey === metricKey) {
            return;
        }
        this.selectedMetricKey = metricKey;
        this.update();
    }

    protected buildPolylinePoints(
        values: readonly AnalyzeTrendPoint[],
        xForIndex: (index: number) => number,
        yForValue: (value: number) => number
    ): string {
        if (values.length === 0) {
            return '';
        }
        return values
            .map((value, index) => {
                const x = xForIndex(index);
                const y = yForValue(value.value);
                return `${x},${y}`;
            })
            .join(' ');
    }

    protected getStatusLabel(status: AnalyzeViewModel['status']): string {
        switch (status) {
            case 'current':
                return 'Current';
            case 'stale':
                return 'Stale';
            case 'loading':
                return 'Loading';
            case 'empty':
            default:
                return 'Idle';
        }
    }

    protected isCompact(): boolean {
        return this.node.getBoundingClientRect().width > 0 && this.node.getBoundingClientRect().width < COMPACT_WIDTH;
    }
}
