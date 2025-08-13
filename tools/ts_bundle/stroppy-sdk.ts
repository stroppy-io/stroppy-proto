import stroppy from "k6/x/stroppy";
import {Options} from 'k6/options';
import {Counter,Trend} from 'k6/metrics';

export type ProtoSerialized<T extends any> = string;

interface StroppyXk6Instance {
    setup(config: ProtoSerialized<StepContext>): Error | undefined;

    generateQueue(): ProtoSerialized<DriverQueriesList>;

    runQuery(query: ProtoSerialized<DriverQuery>): Error | undefined;

    teardown(): Error | undefined;
}

function secondsStringDuration(seconds: number): string {
    return seconds + "s";
}

function numberOrDefault(value: any, defaultValue: number): number {
    if (value === undefined) {
        return defaultValue;
    }
    return isNaN(Number(value)) === true ? defaultValue : Number(value)
}

// passed from Golang execution
export const STROPPY_CONTEXT: StepContext = StepContext.fromJsonString(__ENV.context);
if (!STROPPY_CONTEXT) {
    throw new Error("Please define step run config (-econtext={...})");
}

export const K6_SETUP_TIMEOUT = secondsStringDuration(numberOrDefault(STROPPY_CONTEXT.config.k6Executor.k6SetupTimeout, 1)).toString();
export const K6_STEP_DURATION = secondsStringDuration(numberOrDefault(STROPPY_CONTEXT.config.k6Executor.k6Duration, 1)).toString();
export const K6_STEP_RATE = numberOrDefault(STROPPY_CONTEXT.config.k6Executor.k6Rate, 1);
export const K6_STEP_PRE_ALLOCATED_VUS = numberOrDefault(STROPPY_CONTEXT.config.k6Executor.k6Vus, 1);
export const K6_STEP_MAX_VUS = numberOrDefault(STROPPY_CONTEXT.config.k6Executor.k6MaxVus, 1);
export const K6_DEFAULT_ERROR_PERCENTAGE_THRESHOLD = 50;
export const K6_DEFAULT_ERROR_THRESHOLD = (K6_DEFAULT_ERROR_PERCENTAGE_THRESHOLD * (numberOrDefault(STROPPY_CONTEXT.config.k6Executor.k6Duration, 1) * K6_STEP_RATE) / 100).toString();
export const K6_DEFAULT_TIME_UNITS = "1s";


export const METER_SETUP_TIME_COUNTER = new Counter("setup_time")
export const METER_REQUESTS_COUNTER = new Counter("total_requests");
export const METER_REQUEST_ERROR_COUNTER = new Counter("total_errors");
export const METER_RESPONSES_TIME_TREND = new Trend("response_time");

function setupMetrics() {
    METER_REQUEST_ERROR_COUNTER.add(0);
}

setupMetrics();

export const INSTANCE: StroppyXk6Instance = stroppy.new();

interface CounterMeter {
    values: { count: number, rate: number }
}

interface TrendMeter {
    values: {
        avg: number
        min: number
        med: number
        max: number
        p90: number
        p95: number
    }
}

export class RunResult<T extends any> {
    setup_data: T
    metrics: {
        data_received: CounterMeter
        iteration_duration: TrendMeter
        dropped_iterations?: CounterMeter
        iterations: CounterMeter
        data_sent: CounterMeter

        // Custom metrics
        setup_time: CounterMeter
        total_requests: CounterMeter
        total_errors: CounterMeter
        response_time: TrendMeter
    }
    state: {
        isStdOutTTY: boolean
        isStdErrTTY: boolean
        testRunDurationMs: number
    }
    baggage?: { [name: string]: any }

    withBaggage(baggage: { [name: string]: any }): RunResult<T> {
        this.baggage = baggage;
        return this;
    }

    toJsonString() {
        const testDuration = (this.state.testRunDurationMs - this.metrics.setup_time.values.count) / 1000
        const output = {
            runId: STROPPY_CONTEXT.config.runId,
            benchmark: STROPPY_CONTEXT.benchmark.name,
            step: STROPPY_CONTEXT.step.name,
            seed: STROPPY_CONTEXT.config.seed,
            date: new Date().toLocaleString(),
            ...this.baggage,
            setupData: this.setup_data,
            metadata: {...STROPPY_CONTEXT.config.metadata},
            vus: {
                init: K6_STEP_PRE_ALLOCATED_VUS,
                min: 1,
                max: K6_STEP_MAX_VUS,
            },
            durationAllStagesSec: Number((this.state.testRunDurationMs / 1000).toFixed(5)),
            durationTestSec: testDuration,
            requestsProcessed: this.metrics.total_requests.values.count,
            totalErrors: this.metrics.total_errors.values.count,
            droppedIterations: 'dropped_iterations' in this.metrics ? {
                count: this.metrics.dropped_iterations.values.count,
                rate: this.metrics.dropped_iterations.values.rate
            } : {
                count: 0,
                rate: 0
            },
            rps: {
                actual: Number((this.metrics.total_requests.values.count / testDuration).toFixed(5)),
                actual_success: Number(((this.metrics.total_requests.values.count - this.metrics.total_errors.values.count) / testDuration).toFixed(3)),
                target: -1
            },
            responseTime: "response_time" in this.metrics ? {
                minSec: this.metrics.response_time.values.min / 1000,
                maxSec: this.metrics.response_time.values.max / 1000,
                avgSec: Number((this.metrics.response_time.values.avg / 1000).toFixed(5))
            } : {
                minSec: -1,
                maxSec: -1,
                avgSec: -1
            },
        }
        return JSON.stringify(output, null, 2)
            .replace(/"/g, "")
            .replace(/(\n\s*\n)+/g, "\n");
    }
}

