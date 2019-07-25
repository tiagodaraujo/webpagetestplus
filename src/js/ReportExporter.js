var ReportExporter = function (endpoint, cache = undefined) {
    const appSettings = new AppSettings();
    const endpointQuery = 'jsonResult.php?test=';
    const metricConfig = new ReportMetricConfig();

    let rowSeparator, columnSeparator;

    const getRaw = function (testCode) {
        if (cache) {
            return cache.get(endpoint, testCode, () => getTest(testCode));
        }

        return getTest(testCode);
    }

    const getTest = function (testCode) {
        return new Promise(
            (resolve, reject) => {
                const request = new XMLHttpRequest();
                request.responseType = 'json';
                request.onload = function () {
                    if (this.status === 200) {
                        resolve(processResponseOk(this));
                    } else {
                        reject(processResponseFail(this));
                    }
                };
                request.onerror = function () {
                    reject(processResponseFail(this));
                };
                request.open('GET', getJsonResultUrl(testCode), true);
                request.send();
            });
    }

    const defaultData = function () {
        const data = { header: [], rows: [] };
        data.exportCsv = () => exportCsv.bind(this)(data);
        
        return data;
    }

    const getData = function (reports, options) {
        let data = defaultData();
        if (options.filters.header) {
            data.header = headerData(options.metrics);
        }

        // from
        let steps = reports.reduce((steps, report) => {
            let reportDocument = new ReportDocument(report);
            for (let step of reportDocument.steps()) {
                steps.push(step);
            }

            return steps
        }, []);

        // where
        steps = steps.filter(step => step.accept(options.filters));

        // group by
        if (options.aggregate.type) {
            let aggregateOp = aggregateOperation(options.aggregate.type);
            steps = steps.groupBy(options.aggregate.mergeTest ? pageKeyGetter : pageKeyGetterByTest);
            steps.forEach((v, k, m) => {
                m.set(k, new ReportStepGroup(v, aggregateOp))
            });

            if (options.aggregate.type == 'median') {
                const medianMetric = appSettings.get('medianMetric') || 'plt';
                for (let entry of steps) {
                    let [group, stepGroup] = entry;
                    let items = stepGroup.steps().sort((a, b) => a.getValue(medianMetric) - b.getValue(medianMetric));
                    var medianIndex = Math.round(items.length / 2) - 1;
                    steps.set(group, items[medianIndex]);
                }

                steps = [...steps.values()];
            }
        }

        // select
        data.rows = steps.map(step => step.values(options.metrics.map(m => m.name)));

        return data;
    }

    const exportCsv = function (data) {
        let csv = [];
        
        if (data && data.header && data.header.length) {
            csv.push(data.header.reduce(csvColumnReducer, ''));
        }

        if (data && data.rows && data.rows.length) {
            data.rows.forEach(row => csv.push(row.reduce(csvColumnReducer, '')));
        }

        return csv.reduce(csvRowReducer, '');
    }

    const headerData = function (exportMetrics) {
        return exportMetrics.map(metric => metricConfig.get(metric.name).description);
    }

    const pageKeyGetterByTest = function (step) {
        return step.values(['testId', 'cachedView', 'step'])
            .join('_');
    }

    const pageKeyGetter = function (step) {
        return step.values(['cachedView', 'step'])
            .join('_');
    }

    const aggregateOperation = function (aggregateType) {
        switch (aggregateType) {
            case 'average':
                return Math.avg;

            case 'median':
                return Math.median;

            case 'standardDeviation':
                return Math.stdev;

            default:
                return;
        }
    }

    const processResponseOk = function (response) {
        return response.response.data;
    }

    const processResponseFail = function (response) {
        return new Error(response.statusText);
    }

    const csvColumnReducer = function (line, value) {
        return (line ? line + columnSeparator : '') + value;
    }

    const csvRowReducer = function (csv, line) {
        return (csv ? csv + rowSeparator : '') + line;
    }

    const getJsonResultUrl = function (testCode) {
        return new URL(endpointQuery + testCode, endpoint).href;
    }

    const tranformSettingValue = (value) =>
        !value ? value : value
            .replace("\\t", '\t')
            .replace("\\r", '\r')
            .replace("\\n", '\n');

    const init = function () {
        rowSeparator = tranformSettingValue(appSettings.get('csvRowSeparator'));
        columnSeparator = tranformSettingValue(appSettings.get('csvColumnSeparator'));
    }

    init();

    return {
        defaultData,
        getRaw,
        getData,
        exportCsv
    }
}