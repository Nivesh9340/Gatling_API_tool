package com.example.gatling.ui;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.BindException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class UiGatewayServer {
    private static final Map<String, RunJob> JOBS = new ConcurrentHashMap<>();
    private static final ExecutorService RUN_EXECUTOR = Executors.newCachedThreadPool();
    private static volatile Path PROJECT_ROOT = Path.of("").toAbsolutePath().normalize();
    private static volatile Path RUNS_DIR = PROJECT_ROOT.resolve("target").resolve("ui-runs").normalize();
    private static volatile Path REPORTS_ROOT = PROJECT_ROOT.resolve("target").resolve("gatling").normalize();
    private static volatile int UI_PORT = 8787;
    private static volatile String UI_HOST = "127.0.0.1";

    private UiGatewayServer() {
    }

    public static void main(String[] args) throws Exception {
        PROJECT_ROOT = resolveProjectRoot();
        Properties config = loadUiConfig(PROJECT_ROOT);
        UI_HOST = resolveStringSetting(config, "ui.host", "UI_HOST", "127.0.0.1");
        UI_PORT = resolveIntSetting(config, "ui.port", "UI_PORT", 8787);
        RUNS_DIR = resolvePathSetting(config, "ui.runsDir", "UI_RUNS_DIR", PROJECT_ROOT.resolve("target").resolve("ui-runs"));
        REPORTS_ROOT = resolvePathSetting(config, "ui.reportsDir", "UI_REPORTS_DIR", PROJECT_ROOT.resolve("target").resolve("gatling"));
        Files.createDirectories(RUNS_DIR);

        HttpServer server;
        try {
            server = HttpServer.create(new InetSocketAddress(UI_HOST, UI_PORT), 0);
        } catch (BindException bindException) {
            System.err.println("UI gateway port is already in use: " + UI_HOST + ":" + UI_PORT);
            System.err.println("Stop the existing process using that port or set a different port via:");
            System.err.println("  config/app.properties -> ui.port=<port>");
            System.err.println("  or environment variable UI_PORT");
            return;
        }
        server.createContext("/api/health", new HealthHandler());
        server.createContext("/api/run", new RunHandler());
        server.createContext("/api/hooks/compile", new HookCompileHandler());
        server.createContext("/api/run/status", new RunStatusHandler());
        server.createContext("/reports/", new ReportFileHandler());
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.println("UI gateway running at http://" + UI_HOST + ":" + UI_PORT);
    }

    private static final class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeJson(exchange, 405, "{\"ok\":false,\"error\":\"Method not allowed\"}");
                return;
            }
            writeJson(exchange, 200, "{\"ok\":true}");
        }
    }

    private static final class RunHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeCors(exchange.getResponseHeaders());
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeJson(exchange, 405, "{\"ok\":false,\"error\":\"Method not allowed\"}");
                return;
            }

            String body = readBody(exchange.getRequestBody());
            String yaml = extractJsonString(body, "configYaml");
            String hookSourcesPayload = extractJsonString(body, "hookSourcesPayload");
            if (yaml == null || yaml.isBlank()) {
                writeJson(exchange, 400, "{\"ok\":false,\"error\":\"configYaml is required\"}");
                return;
            }

            Path projectRoot = PROJECT_ROOT;
            Path runsDir = RUNS_DIR;
            Files.createDirectories(runsDir);
            String runId = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT)
                    .withZone(ZoneOffset.UTC)
                    .format(Instant.now());
            Path configPath = runsDir.resolve("ui-config-" + runId + ".yaml");
            Files.writeString(configPath, yaml, StandardCharsets.UTF_8);
            if (hookSourcesPayload != null && !hookSourcesPayload.isBlank()) {
                try {
                    writeHookSources(projectRoot, hookSourcesPayload);
                } catch (IllegalArgumentException ex) {
                    writeJson(exchange, 400, toJson(Map.of("ok", false, "error", ex.getMessage())));
                    return;
                }
            }

            String jobId = UUID.randomUUID().toString();
            RunJob job = new RunJob(jobId, runId, projectRoot, configPath);
            job.state = "queued";
            job.message = "Queued for execution.";
            job.startedAt = Instant.now().toString();
            JOBS.put(jobId, job);
            RUN_EXECUTOR.submit(() -> executeRun(job));

            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("jobId", jobId);
            resp.put("runId", runId);
            resp.put("state", job.state);
            resp.put("message", job.message);
            writeJson(exchange, 202, toJson(resp));
        }
    }

    private static final class HookCompileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeCors(exchange.getResponseHeaders());
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeJson(exchange, 405, "{\"ok\":false,\"error\":\"Method not allowed\"}");
                return;
            }
            String body = readBody(exchange.getRequestBody());
            String hookSourcesPayload = extractJsonString(body, "hookSourcesPayload");
            if (hookSourcesPayload == null || hookSourcesPayload.isBlank()) {
                writeJson(exchange, 400, "{\"ok\":false,\"error\":\"hookSourcesPayload is required\"}");
                return;
            }
            try {
                int written = writeHookSources(PROJECT_ROOT, hookSourcesPayload);
                CommandResult result = runMaven(PROJECT_ROOT, List.of("test-compile"));
                Map<String, Object> resp = new LinkedHashMap<>();
                resp.put("ok", result.exitCode == 0);
                resp.put("written", written);
                resp.put("exitCode", result.exitCode);
                resp.put("message", result.exitCode == 0 ? "Custom hooks compiled successfully." : "Custom hook compile failed.");
                resp.put("output", tail(result.output, 12000));
                writeJson(exchange, result.exitCode == 0 ? 200 : 400, toJson(resp));
            } catch (IllegalArgumentException ex) {
                writeJson(exchange, 400, toJson(Map.of("ok", false, "error", ex.getMessage())));
            } catch (Exception ex) {
                writeJson(exchange, 500, toJson(Map.of("ok", false, "error", ex.getMessage())));
            }
        }
    }

    private static final class RunStatusHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeJson(exchange, 405, "{\"ok\":false,\"error\":\"Method not allowed\"}");
                return;
            }

            String jobId = queryParam(exchange.getRequestURI(), "jobId");
            if (jobId == null || jobId.isBlank()) {
                writeJson(exchange, 400, "{\"ok\":false,\"error\":\"jobId is required\"}");
                return;
            }

            RunJob job = JOBS.get(jobId);
            if (job == null) {
                writeJson(exchange, 404, "{\"ok\":false,\"error\":\"Run job not found\"}");
                return;
            }

            writeJson(exchange, 200, toJson(buildStatusResponse(job)));
        }
    }

    private static final class ReportFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                writeJson(exchange, 405, "{\"ok\":false,\"error\":\"Method not allowed\"}");
                return;
            }
            String requestPath = exchange.getRequestURI().getPath();
            if (requestPath == null || requestPath.length() <= "/reports/".length()) {
                exchange.sendResponseHeaders(404, -1);
                return;
            }
            String relative = requestPath.substring("/reports/".length());
            Path reportsRoot = REPORTS_ROOT;
            Path target = reportsRoot.resolve(relative).normalize();
            if (!target.startsWith(reportsRoot) || !Files.exists(target) || Files.isDirectory(target)) {
                exchange.sendResponseHeaders(404, -1);
                return;
            }
            Headers headers = exchange.getResponseHeaders();
            writeCors(headers);
            headers.set("Content-Type", guessContentType(target));
            byte[] bytes = Files.readAllBytes(target);
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    private static void executeRun(RunJob job) {
        job.state = "running";
        job.message = "Starting Gatling run...";
        String mvnCmd = resolveMavenCommand(job.projectRoot);
        List<String> cmd = new ArrayList<>();
        cmd.add(mvnCmd);
        cmd.add("test-compile");
        cmd.add("-Dgatling.simulationClass=com.example.gatling.simulations.ConfigDrivenApiSimulation");
        cmd.add("-DconfigFile=" + job.configPath.toAbsolutePath().toString().replace("\\", "/"));
        cmd.add("gatling:test");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(job.projectRoot.toFile());
        pb.redirectErrorStream(true);

        try {
            Process process = pb.start();
            job.process = process;
            job.message = "Gatling run is executing.";
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    appendOutput(job, line + System.lineSeparator());
                    job.message = deriveMessage(job.output.toString());
                }
            }
            int exit = process.waitFor();
            job.exitCode = exit;
            job.reportPath = findReportPath(job.output.toString());
            if (job.reportPath != null && !job.reportPath.isBlank()) {
                Path reportIndex = resolveReportIndex(job.reportPath);
                if (reportIndex != null && reportIndex.getParent() != null) {
                    job.reportHttpPath = "/reports/" + reportIndex.getParent().getFileName().toString() + "/index.html";
                }
            }
            if (job.reportPath != null && !job.reportPath.isBlank()) {
                try {
                    job.reportData = parseReportData(job.reportPath);
                } catch (Exception e) {
                    job.reportParseError = e.getMessage();
                }
            }
            job.finishedAt = Instant.now().toString();
            job.state = exit == 0 ? "completed" : "failed";
            job.message = exit == 0 ? "Run completed successfully." : "Run completed with failed assertions or runtime errors.";
        } catch (Exception e) {
            appendOutput(job, System.lineSeparator() + "Runner error: " + e.getMessage());
            job.finishedAt = Instant.now().toString();
            job.state = "error";
            job.message = "Failed to start or complete the Gatling run.";
        }
    }

    private static int writeHookSources(Path projectRoot, String payload) throws IOException {
        Path baseDir = projectRoot.resolve("src").resolve("test").resolve("java")
                .resolve("com").resolve("example").resolve("gatling").resolve("generated").resolve("hooks")
                .toAbsolutePath().normalize();
        Files.createDirectories(baseDir);
        int written = 0;
        for (String line : payload.split("\\r?\\n")) {
            if (line == null || line.isBlank()) {
                continue;
            }
            int sep = line.indexOf('|');
            if (sep <= 0 || sep == line.length() - 1) {
                throw new IllegalArgumentException("Invalid hookSourcesPayload format.");
            }
            String className = line.substring(0, sep).trim();
            if (!className.matches("[A-Za-z_][A-Za-z0-9_]*")) {
                throw new IllegalArgumentException("Invalid generated hook class name: " + className);
            }
            String b64 = line.substring(sep + 1).trim();
            String source = new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
            Path javaFile = baseDir.resolve(className + ".java").normalize();
            if (!javaFile.startsWith(baseDir)) {
                throw new IllegalArgumentException("Unsafe hook path resolved for class: " + className);
            }
            Files.writeString(javaFile, source, StandardCharsets.UTF_8);
            written++;
        }
        return written;
    }

    private static CommandResult runMaven(Path projectRoot, List<String> goals) throws IOException, InterruptedException {
        String mvnCmd = resolveMavenCommand(projectRoot);
        List<String> cmd = new ArrayList<>();
        cmd.add(mvnCmd);
        cmd.addAll(goals);
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(projectRoot.toFile());
        pb.redirectErrorStream(true);
        Process process = pb.start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append(System.lineSeparator());
            }
        }
        int exit = process.waitFor();
        return new CommandResult(exit, output.toString());
    }

    private static Properties loadUiConfig(Path projectRoot) {
        Properties props = new Properties();
        Path configPath = resolveConfigPath(projectRoot);
        if (!Files.exists(configPath)) {
            return props;
        }
        try (InputStream in = Files.newInputStream(configPath)) {
            props.load(in);
        } catch (IOException e) {
            System.err.println("Failed to read UI config file: " + configPath + " (" + e.getMessage() + ")");
        }
        return props;
    }

    private static Path resolveConfigPath(Path projectRoot) {
        String fromProperty = System.getProperty("ui.config", "").trim();
        if (!fromProperty.isBlank()) {
            return Path.of(fromProperty).toAbsolutePath().normalize();
        }
        String fromEnv = System.getenv("UI_CONFIG_FILE");
        if (fromEnv != null && !fromEnv.trim().isBlank()) {
            return Path.of(fromEnv.trim()).toAbsolutePath().normalize();
        }
        return projectRoot.resolve("config").resolve("app.properties").normalize();
    }

    private static String resolveStringSetting(Properties props, String propKey, String envKey, String defaultValue) {
        String fromProperty = System.getProperty(propKey, "").trim();
        if (!fromProperty.isBlank()) {
            return fromProperty;
        }
        String fromEnv = System.getenv(envKey);
        if (fromEnv != null && !fromEnv.trim().isBlank()) {
            return fromEnv.trim();
        }
        String fromFile = props.getProperty(propKey, "").trim();
        if (!fromFile.isBlank()) {
            return fromFile;
        }
        return defaultValue;
    }

    private static int resolveIntSetting(Properties props, String propKey, String envKey, int defaultValue) {
        String value = resolveStringSetting(props, propKey, envKey, String.valueOf(defaultValue));
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException ignored) {
            return defaultValue;
        }
    }

    private static Path resolvePathSetting(Properties props, String propKey, String envKey, Path defaultPath) {
        String value = resolveStringSetting(props, propKey, envKey, "");
        if (value.isBlank()) {
            return defaultPath.toAbsolutePath().normalize();
        }
        Path candidate = Path.of(value);
        if (!candidate.isAbsolute()) {
            candidate = PROJECT_ROOT.resolve(candidate);
        }
        return candidate.toAbsolutePath().normalize();
    }

    private static Path resolveProjectRoot() {
        Path cwd = Path.of("").toAbsolutePath().normalize();
        if (Files.exists(cwd.resolve("pom.xml"))) {
            return cwd;
        }
        Path nested = cwd.resolve("gatling-api-tool");
        if (Files.exists(nested.resolve("pom.xml"))) {
            return nested;
        }
        return cwd;
    }

    private static String resolveMavenCommand(Path projectRoot) {
        String configured = stripWrappingQuotes(System.getProperty("ui.mvnCmd", "").trim());
        if (!configured.isBlank() && commandLooksUsable(configured, projectRoot)) {
            return configured;
        }
        Path wrapper = projectRoot.resolve("mvnw.cmd");
        if (Files.exists(wrapper)) {
            return wrapper.toAbsolutePath().toString();
        }
        return "mvn.cmd";
    }

    private static boolean commandLooksUsable(String cmd, Path projectRoot) {
        if (cmd.contains("\\") || cmd.contains("/") || cmd.contains(":")) {
            Path path = Path.of(cmd);
            if (!path.isAbsolute()) {
                path = projectRoot.resolve(path);
            }
            return Files.exists(path.normalize());
        }
        return true;
    }

    private static String stripWrappingQuotes(String value) {
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private static void appendOutput(RunJob job, String chunk) {
        synchronized (job) {
            job.output.append(chunk);
        }
    }

    private static Map<String, Object> buildStatusResponse(RunJob job) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("ok", "completed".equals(job.state));
        response.put("jobId", job.jobId);
        response.put("runId", job.runId);
        response.put("state", job.state);
        response.put("message", job.message);
        response.put("startedAt", job.startedAt);
        response.put("finishedAt", job.finishedAt == null ? "" : job.finishedAt);
        response.put("exitCode", job.exitCode);
        response.put("reportPath", job.reportPath == null ? "" : job.reportPath);
        response.put("reportHttpUrl", job.reportHttpPath == null ? "" : ("http://" + UI_HOST + ":" + UI_PORT + job.reportHttpPath));
        response.put("reportParseError", job.reportParseError == null ? "" : job.reportParseError);
        response.put("outputTail", tail(job.output.toString(), 10000));
        response.put("liveData", parseLiveConsoleData(job.output.toString()));
        response.put("reportData", job.reportData);
        return response;
    }

    private static Map<String, Object> parseLiveConsoleData(String output) {
        int idx = output.lastIndexOf("---- Requests ");
        if (idx < 0) {
            return null;
        }
        int end = output.indexOf("========================================================================================================================", idx);
        if (end < 0) {
            end = output.length();
        }
        String block = output.substring(idx, end);
        Matcher rowMatcher = Pattern.compile(">\\s+(.+?)\\s+\\|\\s+(\\d+)\\s+\\|\\s+(\\d+)\\s+\\|\\s+(\\d+)").matcher(block);
        List<Map<String, Object>> rows = new ArrayList<>();
        int scenarios = 0;
        int total = 0;
        int success = 0;
        while (rowMatcher.find()) {
            String name = rowMatcher.group(1).trim();
            int rowTotal = Integer.parseInt(rowMatcher.group(2));
            int rowOk = Integer.parseInt(rowMatcher.group(3));
            int rowKo = Integer.parseInt(rowMatcher.group(4));
            if ("Global".equalsIgnoreCase(name)) {
                total = rowTotal;
                success = rowOk;
                continue;
            }
            scenarios += 1;
            String scenario = name;
            String step = name;
            int split = name.lastIndexOf(" / ");
            if (split >= 0) {
                scenario = name.substring(0, split).trim();
                step = name.substring(split + 3).trim();
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", sanitizeId(name));
            row.put("scenario", scenario);
            row.put("step", step);
            row.put("total", rowTotal);
            row.put("success", rowOk);
            row.put("successPct", formatPercent(rowOk, rowTotal));
            row.put("min", 0);
            row.put("avg", 0);
            row.put("p90", 0);
            row.put("p95", 0);
            row.put("p99", 0);
            row.put("max", 0);
            row.put("status", "OK " + rowOk + " | KO " + rowKo);
            row.put("parity", "Live console");
            rows.add(row);
        }
        if (total == 0 && rows.isEmpty()) {
            return null;
        }
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("scenarios", scenarios);
        summary.put("steps", rows.size());
        summary.put("total", total);
        summary.put("success", success);
        summary.put("successPct", formatPercent(success, total) + "%");
        summary.put("minRt", 0);
        summary.put("avgRt", 0);
        summary.put("p95Rt", 0);
        summary.put("p99Rt", 0);
        summary.put("maxRt", 0);
        summary.put("parity", 0);

        List<Map<String, Object>> scenarioSummary = new ArrayList<>();
        Map<String, Map<String, Object>> grouped = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            String scenario = String.valueOf(row.get("scenario"));
            Map<String, Object> agg = grouped.computeIfAbsent(scenario, key -> {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("name", key);
                out.put("total", 0);
                out.put("success", 0);
                out.put("successPct", "0.00");
                out.put("avg", 0);
                out.put("p95", 0);
                out.put("max", 0);
                return out;
            });
            int aggTotal = ((Number) agg.get("total")).intValue() + ((Number) row.get("total")).intValue();
            int aggSuccess = ((Number) agg.get("success")).intValue() + ((Number) row.get("success")).intValue();
            agg.put("total", aggTotal);
            agg.put("success", aggSuccess);
            agg.put("successPct", formatPercent(aggSuccess, aggTotal));
        }
        scenarioSummary.addAll(grouped.values());

        Map<String, Object> live = new LinkedHashMap<>();
        live.put("summary", summary);
        live.put("rows", rows);
        live.put("scenarioSummary", scenarioSummary);
        live.put("failReasons", List.of());
        live.put("parityRows", List.of());
        live.put("diag", Map.of());
        return live;
    }

    private static String deriveMessage(String output) {
        if (output.contains("Generating reports")) {
            return "Generating Gatling reports...";
        }
        if (output.contains("Parsing log file(s)")) {
            return "Parsing Gatling logs...";
        }
        if (output.contains("Simulation com.example.gatling.simulations.ConfigDrivenApiSimulation started")) {
            return "Simulation started.";
        }
        int idx = output.lastIndexOf("]    ");
        if (idx >= 0) {
            int pctStart = idx + 5;
            int pctEnd = output.indexOf('%', pctStart);
            if (pctEnd > pctStart) {
                return "Run in progress: " + output.substring(pctStart, pctEnd + 1).trim();
            }
        }
        return "Gatling run is executing.";
    }

    private static String queryParam(URI uri, String key) {
        String query = uri.getRawQuery();
        if (query == null || query.isBlank()) {
            return null;
        }
        for (String part : query.split("&")) {
            int idx = part.indexOf('=');
            if (idx < 0) {
                continue;
            }
            String name = part.substring(0, idx);
            if (key.equals(name)) {
                return part.substring(idx + 1);
            }
        }
        return null;
    }

    private static String tail(String text, int max) {
        if (text == null) {
            return "";
        }
        if (text.length() <= max) {
            return text;
        }
        return text.substring(text.length() - max);
    }

    private static Map<String, Object> parseReportData(String reportPath) throws IOException {
        Path indexPath = resolveReportIndex(reportPath);
        if (indexPath == null || !Files.exists(indexPath)) {
            return null;
        }

        String html = Files.readString(indexPath, StandardCharsets.UTF_8);
        StatsRow global = parseRootRow(html);
        if (global == null) {
            return null;
        }

        List<StatsRow> allRows = parseRows(html);
        List<StatsRow> topLevelRows = new ArrayList<>();
        for (StatsRow row : allRows) {
            if ("ROOT".equals(row.parentId)) {
                topLevelRows.add(row);
            }
        }

        List<Map<String, Object>> resultRows = new ArrayList<>();
        List<Map<String, Object>> scenarioSummary = new ArrayList<>();
        List<Map<String, Object>> failReasons = new ArrayList<>();
        List<Object> parityRows = new ArrayList<>();
        Map<String, Object> diag = new LinkedHashMap<>();
        int requestCount = 0;

        for (StatsRow topLevel : topLevelRows) {
            List<StatsRow> children = childrenOf(allRows, topLevel.id);
            if (children.isEmpty()) {
                requestCount += 1;
                String rowId = sanitizeId(topLevel.id);
                resultRows.add(buildRequestRow(topLevel.name, topLevel.name, rowId, topLevel));
                diag.put(rowId, buildDiag(topLevel));
                scenarioSummary.add(buildScenarioSummary(topLevel.name, topLevel));
                if (topLevel.ko > 0) {
                    failReasons.add(reasonRow(topLevel.name + " failed requests", topLevel.ko));
                }
                continue;
            }

            scenarioSummary.add(buildScenarioSummary(topLevel.name, topLevel));
            for (StatsRow child : children) {
                requestCount += 1;
                String rowId = sanitizeId(child.id);
                resultRows.add(buildRequestRow(topLevel.name, child.name, rowId, child));
                diag.put(rowId, buildDiag(child));
                if (child.ko > 0) {
                    failReasons.add(reasonRow(topLevel.name + " / " + child.name + " failed requests", child.ko));
                }
            }
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("scenarios", scenarioSummary.size());
        summary.put("steps", requestCount);
        summary.put("total", global.total);
        summary.put("success", global.ok);
        summary.put("successPct", formatPercent(global.ok, global.total) + "%");
        summary.put("minRt", global.min);
        summary.put("avgRt", global.mean);
        summary.put("p95Rt", global.p95);
        summary.put("p99Rt", global.p99);
        summary.put("maxRt", global.max);
        summary.put("parity", 0);

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("summary", summary);
        report.put("rows", resultRows);
        report.put("scenarioSummary", scenarioSummary);
        report.put("failReasons", failReasons);
        report.put("parityRows", parityRows);
        report.put("diag", diag);
        return report;
    }

    private static Path resolveReportIndex(String reportPath) {
        if (reportPath == null || reportPath.isBlank()) {
            return null;
        }
        String raw = reportPath.trim();
        Path path = raw.startsWith("file:/") ? Path.of(URI.create(raw)) : Path.of(raw);
        if (Files.isDirectory(path)) {
            return path.resolve("index.html");
        }
        return path;
    }

    private static StatsRow parseRootRow(String html) {
        Matcher matcher = Pattern.compile("<tr\\s+id=\"ROOT\"[^>]*>(.*?)</tr>", Pattern.DOTALL).matcher(html);
        if (!matcher.find()) {
            return null;
        }
        return parseRow("ROOT", null, matcher.group(1));
    }

    private static List<StatsRow> parseRows(String html) {
        List<StatsRow> rows = new ArrayList<>();
        Matcher matcher = Pattern.compile("<tr\\s+id=\"([^\"]+)\"([^>]*)>(.*?)</tr>", Pattern.DOTALL).matcher(html);
        while (matcher.find()) {
            String id = matcher.group(1);
            if ("ROOT".equals(id)) {
                continue;
            }
            rows.add(parseRow(id, extractAttr(matcher.group(2), "data-parent"), matcher.group(3)));
        }
        return rows;
    }

    private static StatsRow parseRow(String id, String parentId, String rowHtml) {
        return new StatsRow(
                id,
                parentId,
                extractName(rowHtml),
                parseIntCell(rowHtml, "col-2"),
                parseIntCell(rowHtml, "col-3"),
                parseIntCell(rowHtml, "col-4"),
                parseIntCell(rowHtml, "col-7"),
                parseIntCell(rowHtml, "col-10"),
                parseIntCell(rowHtml, "col-11"),
                parseIntCell(rowHtml, "col-12"),
                parseIntCell(rowHtml, "col-13")
        );
    }

    private static String extractName(String rowHtml) {
        Matcher matcher = Pattern.compile("<span[^>]*class=\"ellipsed-name\"[^>]*>(.*?)</span>", Pattern.DOTALL).matcher(rowHtml);
        return matcher.find() ? htmlText(matcher.group(1)) : "-";
    }

    private static int parseIntCell(String rowHtml, String col) {
        Matcher matcher = Pattern.compile("<td[^>]*class=\"[^\"]*\\b" + Pattern.quote(col) + "\\b[^\"]*\"[^>]*>(.*?)</td>", Pattern.DOTALL).matcher(rowHtml);
        if (!matcher.find()) {
            return 0;
        }
        String text = htmlText(matcher.group(1)).replace(",", "");
        if (text.isBlank()) {
            return 0;
        }
        try {
            return (int) Math.round(Double.parseDouble(text));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String extractAttr(String attrs, String name) {
        Matcher matcher = Pattern.compile(name + "=\"([^\"]*)\"").matcher(attrs);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String htmlText(String html) {
        String text = html.replaceAll("<[^>]+>", " ").replace('\u00A0', ' ');
        text = text.replace("&nbsp;", " ")
                .replace("&mdash;", "-")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
        return text.replaceAll("\\s+", " ").trim();
    }

    private static List<StatsRow> childrenOf(List<StatsRow> rows, String parentId) {
        List<StatsRow> children = new ArrayList<>();
        for (StatsRow row : rows) {
            if (parentId.equals(row.parentId)) {
                children.add(row);
            }
        }
        return children;
    }

    private static Map<String, Object> buildRequestRow(String scenario, String step, String rowId, StatsRow row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", rowId);
        out.put("scenario", scenario);
        out.put("step", step);
        out.put("total", row.total);
        out.put("success", row.ok);
        out.put("successPct", formatPercent(row.ok, row.total));
        out.put("min", row.min);
        out.put("avg", row.mean);
        out.put("p90", 0);
        out.put("p95", row.p95);
        out.put("p99", row.p99);
        out.put("max", row.max);
        out.put("status", "OK " + row.ok + " | KO " + row.ko);
        out.put("parity", "Real Gatling");
        return out;
    }

    private static Map<String, Object> buildScenarioSummary(String name, StatsRow row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("total", row.total);
        out.put("success", row.ok);
        out.put("successPct", formatPercent(row.ok, row.total));
        out.put("avg", row.mean);
        out.put("p95", row.p95);
        out.put("max", row.max);
        return out;
    }

    private static Map<String, Object> buildDiag(StatsRow row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", "gatling");
        out.put("expected", "-");
        out.put("total", row.total);
        out.put("success", row.ok);
        out.put("failReasons", row.ko > 0 ? Map.of("Failed requests", row.ko) : Map.of());
        out.put("parityWarnings", List.of());
        out.put("statusCounts", Map.of("OK", row.ok, "KO", row.ko));
        return out;
    }

    private static Map<String, Object> reasonRow(String reason, int count) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("reason", reason);
        out.put("count", count);
        return out;
    }

    private static String sanitizeId(String raw) {
        return raw == null ? "" : raw.replaceAll("[^a-zA-Z0-9_]", "_");
    }

    private static String formatPercent(int success, int total) {
        if (total <= 0) {
            return "0.00";
        }
        return String.format(Locale.ROOT, "%.2f", (success * 100.0) / total);
    }

    private static String guessContentType(Path file) throws IOException {
        String detected = Files.probeContentType(file);
        if (detected != null && !detected.isBlank()) {
            return detected;
        }
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".ico")) return "image/x-icon";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    private static String readBody(InputStream is) throws IOException {
        return new String(is.readAllBytes(), StandardCharsets.UTF_8);
    }

    private static String extractJsonString(String json, String key) {
        String marker = "\"" + key + "\"";
        int i = json.indexOf(marker);
        if (i < 0) return null;
        int colon = json.indexOf(':', i + marker.length());
        if (colon < 0) return null;
        int start = json.indexOf('"', colon + 1);
        if (start < 0) return null;
        StringBuilder out = new StringBuilder();
        boolean escaped = false;
        for (int j = start + 1; j < json.length(); j++) {
            char c = json.charAt(j);
            if (escaped) {
                switch (c) {
                    case 'n': out.append('\n'); break;
                    case 'r': out.append('\r'); break;
                    case 't': out.append('\t'); break;
                    case '"': out.append('"'); break;
                    case '\\': out.append('\\'); break;
                    default: out.append(c); break;
                }
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                return out.toString();
            } else {
                out.append(c);
            }
        }
        return null;
    }

    private static String findReportPath(String output) {
        String marker = "Reports generated, please open the following file:";
        int idx = output.lastIndexOf(marker);
        if (idx < 0) {
            return null;
        }
        String tail = output.substring(idx + marker.length()).trim();
        int eol = tail.indexOf('\n');
        if (eol >= 0) {
            tail = tail.substring(0, eol).trim();
        }
        return tail;
    }

    private static String toJson(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof String) {
            return "\"" + esc((String) value) + "\"";
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        if (value instanceof Map<?, ?> map) {
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) out.append(',');
                first = false;
                out.append(toJson(String.valueOf(entry.getKey()))).append(':').append(toJson(entry.getValue()));
            }
            out.append('}');
            return out.toString();
        }
        if (value instanceof Iterable<?> items) {
            StringBuilder out = new StringBuilder("[");
            boolean first = true;
            for (Object item : items) {
                if (!first) out.append(',');
                first = false;
                out.append(toJson(item));
            }
            out.append(']');
            return out.toString();
        }
        return toJson(String.valueOf(value));
    }

    private static void writeJson(HttpExchange exchange, int status, String body) throws IOException {
        Headers h = exchange.getResponseHeaders();
        writeCors(h);
        h.add("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static void writeCors(Headers h) {
        h.set("Access-Control-Allow-Origin", "*");
        h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        h.set("Access-Control-Allow-Headers", "Content-Type");
    }

    private static String esc(String s) {
        String in = s == null ? "" : s;
        StringBuilder out = new StringBuilder(in.length() + 32);
        for (int i = 0; i < in.length(); i++) {
            char c = in.charAt(i);
            switch (c) {
                case '\\': out.append("\\\\"); break;
                case '"': out.append("\\\""); break;
                case '\r': out.append("\\r"); break;
                case '\n': out.append("\\n"); break;
                case '\t': out.append("\\t"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                    break;
            }
        }
        return out.toString();
    }

    private static final class RunJob {
        private final String jobId;
        private final String runId;
        private final Path projectRoot;
        private final Path configPath;
        private final StringBuilder output = new StringBuilder();
        private volatile String state;
        private volatile String message;
        private volatile String startedAt;
        private volatile String finishedAt;
        private volatile Integer exitCode;
        private volatile String reportPath;
        private volatile String reportHttpPath;
        private volatile String reportParseError;
        private volatile Map<String, Object> reportData;
        private volatile Process process;

        private RunJob(String jobId, String runId, Path projectRoot, Path configPath) {
            this.jobId = jobId;
            this.runId = runId;
            this.projectRoot = projectRoot;
            this.configPath = configPath;
        }
    }

    private static final class StatsRow {
        private final String id;
        private final String parentId;
        private final String name;
        private final int total;
        private final int ok;
        private final int ko;
        private final int min;
        private final int p95;
        private final int p99;
        private final int max;
        private final int mean;

        private StatsRow(String id, String parentId, String name, int total, int ok, int ko, int min, int p95, int p99, int max, int mean) {
            this.id = id;
            this.parentId = parentId;
            this.name = name;
            this.total = total;
            this.ok = ok;
            this.ko = ko;
            this.min = min;
            this.p95 = p95;
            this.p99 = p99;
            this.max = max;
            this.mean = mean;
        }
    }

    private static final class CommandResult {
        private final int exitCode;
        private final String output;

        private CommandResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output == null ? "" : output;
        }
    }
}
