package com.example.gatling.simulations;

import com.example.gatling.config.ConfigLoader;
import com.example.gatling.config.ConfigModels;
import com.example.gatling.extensions.StepHookExtension;
import io.gatling.javaapi.core.ChainBuilder;
import io.gatling.javaapi.core.Assertion;
import io.gatling.javaapi.core.PopulationBuilder;
import io.gatling.javaapi.core.ScenarioBuilder;
import io.gatling.javaapi.core.Session;
import io.gatling.javaapi.core.Simulation;
import io.gatling.javaapi.http.HttpProtocolBuilder;
import io.gatling.javaapi.http.HttpRequestActionBuilder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static io.gatling.javaapi.core.CoreDsl.exec;
import static io.gatling.javaapi.core.CoreDsl.asLongAs;
import static io.gatling.javaapi.core.CoreDsl.details;
import static io.gatling.javaapi.core.CoreDsl.doIf;
import static io.gatling.javaapi.core.CoreDsl.doIfOrElse;
import static io.gatling.javaapi.core.CoreDsl.exitHereIfFailed;
import static io.gatling.javaapi.core.CoreDsl.global;
import static io.gatling.javaapi.core.CoreDsl.group;
import static io.gatling.javaapi.core.CoreDsl.jsonPath;
import static io.gatling.javaapi.core.CoreDsl.pause;
import static io.gatling.javaapi.core.CoreDsl.rampUsers;
import static io.gatling.javaapi.core.CoreDsl.repeat;
import static io.gatling.javaapi.core.CoreDsl.constantUsersPerSec;
import static io.gatling.javaapi.core.CoreDsl.rampUsersPerSec;
import static io.gatling.javaapi.core.CoreDsl.incrementUsersPerSec;
import static io.gatling.javaapi.core.CoreDsl.constantConcurrentUsers;
import static io.gatling.javaapi.core.CoreDsl.rampConcurrentUsers;
import static io.gatling.javaapi.core.CoreDsl.regex;
import static io.gatling.javaapi.core.CoreDsl.scenario;
import static io.gatling.javaapi.core.CoreDsl.StringBody;
import static io.gatling.javaapi.core.CoreDsl.substring;
import static io.gatling.javaapi.core.CoreDsl.csv;
import static io.gatling.javaapi.core.CoreDsl.bodyLength;
import static io.gatling.javaapi.core.CoreDsl.jmesPath;
import static io.gatling.javaapi.http.HttpDsl.http;
import static io.gatling.javaapi.http.HttpDsl.status;
import static io.gatling.javaapi.http.HttpDsl.header;
import static io.gatling.javaapi.core.CoreDsl.atOnceUsers;
import static io.gatling.javaapi.core.CoreDsl.during;
import static io.gatling.javaapi.core.CoreDsl.pace;
import static io.gatling.javaapi.core.CoreDsl.tryMax;

public class ConfigDrivenApiSimulation extends Simulation {
    private static final String CONFIG_PATH = System.getProperty("configFile", "src/test/resources/sample-config.yaml");

    private final ConfigModels.TestPlan plan = ConfigLoader.load(CONFIG_PATH);
    private final Map<String, StepHookExtension> stepHookCache = new ConcurrentHashMap<>();

    {
        if (plan.applications != null && !plan.applications.isEmpty()) {
            setUpMultiApp();
        } else {
            setUpLegacy();
        }
    }

    private void setUpLegacy() {
        HttpProtocolBuilder httpProtocol = buildHttpProtocol(resolveService(plan));
        List<PopulationBuilder> populations = buildPopulations(plan.scenarios, null, null);
        var setupBuilder = setUp(populations.toArray(new PopulationBuilder[0])).protocols(httpProtocol);
        List<Assertion> assertions = buildAssertions(plan.assertions);
        if (!assertions.isEmpty()) {
            setupBuilder.assertions(assertions.toArray(new Assertion[0]));
        }
    }

    private void setUpMultiApp() {
        List<PopulationBuilder> populations = new ArrayList<>();
        List<Assertion> assertions = new ArrayList<>();

        for (var entry : plan.applications.entrySet()) {
            String appName = entry.getKey();
            ConfigModels.ApplicationConfig app = entry.getValue();
            if (app == null || (app.enabled != null && !app.enabled)) {
                continue;
            }
            HttpProtocolBuilder appProtocol = buildHttpProtocol(resolveServiceForApp(app));
            List<PopulationBuilder> appPops = buildPopulations(app.scenarios, appName, app.injectionProfiles);
            for (PopulationBuilder pop : appPops) {
                populations.add(pop.protocols(appProtocol));
            }
            ConfigModels.AssertionsConfig appAssertions = app.assertions != null ? app.assertions : plan.assertions;
            if (appAssertions != null) {
                assertions.addAll(buildScopedAssertionsForApp(appName, app.scenarios, appAssertions));
            }
        }

        if (populations.isEmpty()) {
            throw new IllegalArgumentException("No enabled application/scenario populations to run.");
        }
        var setupBuilder = setUp(populations.toArray(new PopulationBuilder[0]));
        if (!assertions.isEmpty()) {
            setupBuilder.assertions(assertions.toArray(new Assertion[0]));
        }
    }

    private List<PopulationBuilder> buildPopulations(
            List<ConfigModels.ScenarioConfig> scenarios,
            String appPrefix,
            Map<String, ConfigModels.LoadProfile> injectionProfiles
    ) {
        List<PopulationBuilder> populations = new ArrayList<>();
        for (ConfigModels.ScenarioConfig scenarioConfig : scenarios) {
            ChainBuilder chain = exec(session -> session);
            for (ConfigModels.RequestStep step : scenarioConfig.steps) {
                ChainBuilder stepChain = buildStepChain(step);
                chain = chain.exec(stepChain);
                if (step.pauseMs != null && step.pauseMs > 0) {
                    chain = chain.pause(Duration.ofMillis(step.pauseMs));
                }
            }
            if (scenarioConfig.flow != null) {
                if (scenarioConfig.flow.repeatCount != null && scenarioConfig.flow.repeatCount > 0) {
                    chain = repeat(scenarioConfig.flow.repeatCount).on(chain);
                }
                if (scenarioConfig.flow.duringSec != null && scenarioConfig.flow.duringSec > 0) {
                    chain = during(Duration.ofSeconds(scenarioConfig.flow.duringSec)).on(chain);
                }
                if (scenarioConfig.flow.asLongAsVariable != null
                        && !scenarioConfig.flow.asLongAsVariable.isBlank()
                        && scenarioConfig.flow.asLongAsEquals != null) {
                    String loopExpr = "#{"
                            + scenarioConfig.flow.asLongAsVariable
                            + ".string() == '"
                            + scenarioConfig.flow.asLongAsEquals.replace("'", "\\'")
                            + "'}";
                    chain = asLongAs(loopExpr).on(chain);
                }
                if (Boolean.TRUE.equals(scenarioConfig.flow.exitOnFail)) {
                    chain = chain.exec(exitHereIfFailed());
                }
            }
            String scenarioName = appPrefix == null ? scenarioConfig.name : appPrefix + " :: " + scenarioConfig.name;
            ChainBuilder groupedChain = group(scenarioName).on(chain);
            ScenarioBuilder scn = scenario(scenarioName);
            if (scenarioConfig.feeder != null) {
                scn = applyFeeder(scn, scenarioConfig.feeder);
            }
            ConfigModels.LoadProfile load = resolveLoadProfile(scenarioConfig.load, injectionProfiles);
            String injectionType = isBlank(load.injectionType) ? inferInjectionType(load) : load.injectionType.trim().toLowerCase(Locale.ROOT);

            switch (injectionType) {
                case "pacedusers": {
                    ChainBuilder pacedWindow = during(Duration.ofSeconds(load.durationSec))
                            .on(pace(Duration.ofMillis(load.paceMs)).exec(groupedChain));
                    scn = scn.exec(pacedWindow);
                    populations.add(scn.injectOpen(atOnceUsers(load.users)));
                    break;
                }
                case "atonceusers":
                    scn = scn.exec(groupedChain);
                    populations.add(scn.injectOpen(atOnceUsers(load.users)));
                    break;
                case "constantuserspersec":
                    scn = scn.exec(groupedChain);
                    populations.add(scn.injectOpen(constantUsersPerSec(load.rate).during(Duration.ofSeconds(load.durationSec))));
                    break;
                case "rampuserspersec":
                    scn = scn.exec(groupedChain);
                    populations.add(scn.injectOpen(
                            rampUsersPerSec(load.fromRps)
                                    .to(load.toRps)
                                    .during(Duration.ofSeconds(load.durationSec))
                    ));
                    break;
                case "incrementuserspersec":
                    scn = scn.exec(groupedChain);
                    var stairs = incrementUsersPerSec(load.incrementBy)
                            .times(load.levelCount)
                            .eachLevelLasting(Duration.ofSeconds(load.levelDurationSec));
                    if (load.startRate != null && load.startRate > 0) {
                        stairs = stairs.startingFrom(load.startRate);
                    }
                    populations.add(scn.injectOpen(stairs));
                    break;
                case "constantconcurrentusers":
                    scn = scn.exec(groupedChain);
                    populations.add(scn.injectClosed(
                            constantConcurrentUsers(load.users)
                                    .during(Duration.ofSeconds(load.durationSec))
                    ));
                    break;
                case "rampconcurrentusers":
                    scn = scn.exec(groupedChain);
                    populations.add(scn.injectClosed(
                            rampConcurrentUsers(load.fromUsers)
                                    .to(load.toUsers)
                                    .during(Duration.ofSeconds(load.durationSec))
                    ));
                    break;
                case "rampusers":
                default:
                    scn = scn.exec(groupedChain);
                    populations.add(
                            scn.injectOpen(
                                    rampUsers(load.users)
                                            .during(Duration.ofSeconds(load.rampDurationSec))
                            )
                    );
                    break;
            }
        }
        return populations;
    }

    private ChainBuilder buildStepChain(ConfigModels.RequestStep step) {
        List<BranchCandidate> branches = new ArrayList<>();
        if (step.branches != null) {
            for (ConfigModels.ConditionalBranchConfig branch : step.branches) {
                String expr = buildCondition(branch == null ? null : branch.when);
                if (expr != null) {
                    branches.add(new BranchCandidate(expr, mergeBranchStep(step, branch, false)));
                }
            }
        } else {
            String legacyExpr = buildCondition(step.condition);
            if (legacyExpr != null) {
                branches.add(new BranchCandidate(legacyExpr, copyStep(step)));
            }
        }

        ConfigModels.RequestStep fallback = step.fallback != null
                ? mergeBranchStep(step, step.fallback, true)
                : buildElseStep(step);

        if (branches.isEmpty()) {
            return buildExecutableChain(copyStep(step));
        }

        ChainBuilder current = fallback == null
                ? exec(session -> session)
                : buildExecutableChain(fallback);
        for (int i = branches.size() - 1; i >= 0; i--) {
            BranchCandidate branch = branches.get(i);
            current = doIfOrElse(branch.conditionExpression)
                    .then(buildExecutableChain(branch.step))
                    .orElse(current);
        }
        return current;
    }

    private ChainBuilder buildExecutableChain(ConfigModels.RequestStep step) {
        ChainBuilder chain = exec(session -> applyStepHookBefore(session, step))
                .exec(buildRequest(step))
                .exec(session -> applyStepHookAfter(session, step));
        if (step.retryCount != null && step.retryCount > 0) {
            chain = tryMax(step.retryCount + 1).on(chain);
        }
        return chain;
    }

    private String buildCondition(ConfigModels.ConditionConfig condition) {
        if (condition == null || condition.variable == null || condition.variable.isBlank()) {
            return null;
        }
        String variable = condition.variable;
        String operator = condition.operator == null || condition.operator.isBlank()
                ? (condition.equals != null ? "equals" : "exists")
                : condition.operator.trim().toLowerCase(Locale.ROOT);
        String value = condition.value != null ? condition.value : condition.equals;
        switch (operator) {
            case "equals":
                return "#{" + variable + ".string() == '" + escapeForCondition(value) + "'}";
            case "notequals":
                return "#{" + variable + ".string() != '" + escapeForCondition(value) + "'}";
            case "exists":
                return "#{" + variable + ".exists()}";
            case "notexists":
                return "#{!" + variable + ".exists()}";
            case "contains":
                return "#{" + variable + ".string().contains('" + escapeForCondition(value) + "')}";
            case "in":
                List<String> values = condition.values == null || condition.values.isEmpty()
                        ? List.of(value == null ? "" : value)
                        : condition.values;
                String joined = String.join(" || ", values.stream()
                        .map(v -> variable + ".string() == '" + escapeForCondition(v) + "'")
                        .toList());
                return "#{" + joined + "}";
            default:
                throw new IllegalArgumentException("Unsupported condition operator: " + condition.operator);
        }
    }

    private String escapeForCondition(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("'", "\\'");
    }

    private ConfigModels.RequestStep buildElseStep(ConfigModels.RequestStep step) {
        if (step.elseMethod == null || step.elseMethod.isBlank() || step.elsePath == null || step.elsePath.isBlank()) {
            return null;
        }
        ConfigModels.RequestStep elseStep = new ConfigModels.RequestStep();
        elseStep.name = step.name + " (else)";
        elseStep.method = step.elseMethod;
        elseStep.path = step.elsePath;
        elseStep.customHookRef = step.customHookRef;
        elseStep.customHookName = step.customHookName;
        elseStep.headers = step.headers;
        elseStep.queryParams = step.queryParams;
        elseStep.formParams = step.formParams;
        elseStep.body = step.elseBody;
        elseStep.bodyFile = step.bodyFile;
        elseStep.bodyType = step.bodyType;
        elseStep.formUploads = step.formUploads;
        elseStep.auth = step.auth;
        elseStep.disableFollowRedirect = step.disableFollowRedirect;
        elseStep.disableUrlEncoding = step.disableUrlEncoding;
        elseStep.silent = step.silent;
        elseStep.ignoreProtocolHeaders = step.ignoreProtocolHeaders;
        elseStep.requestTimeoutMs = step.requestTimeoutMs;
        elseStep.expectedStatus = step.elseExpectedStatus != null ? step.elseExpectedStatus : step.expectedStatus;
        elseStep.pauseMs = step.pauseMs;
        elseStep.checks = step.checks;
        elseStep.captures = step.captures;
        return elseStep;
    }

    private ConfigModels.RequestStep copyStep(ConfigModels.RequestStep source) {
        ConfigModels.RequestStep copy = new ConfigModels.RequestStep();
        copy.name = source.name;
        copy.method = source.method;
        copy.path = source.path;
        copy.url = source.url;
        copy.customHookRef = source.customHookRef;
        copy.customHookName = source.customHookName;
        copy.headers = copyMap(source.headers);
        copy.queryParams = copyMap(source.queryParams);
        copy.formParams = copyMap(source.formParams);
        copy.body = source.body;
        copy.bodyFile = source.bodyFile;
        copy.bodyType = source.bodyType;
        copy.formUploads = copyUploads(source.formUploads);
        copy.auth = copyAuth(source.auth);
        copy.disableFollowRedirect = source.disableFollowRedirect;
        copy.disableUrlEncoding = source.disableUrlEncoding;
        copy.silent = source.silent;
        copy.ignoreProtocolHeaders = source.ignoreProtocolHeaders;
        copy.requestTimeoutMs = source.requestTimeoutMs;
        copy.retryCount = source.retryCount;
        copy.expectedStatus = source.expectedStatus;
        copy.pauseMs = source.pauseMs;
        copy.checks = copyChecks(source.checks);
        copy.captures = copyCaptures(source.captures);
        return copy;
    }

    private ConfigModels.RequestStep mergeBranchStep(
            ConfigModels.RequestStep parent,
            ConfigModels.ConditionalBranchConfig branch,
            boolean fallback
    ) {
        ConfigModels.RequestStep merged = copyStep(parent);
        if (!isBlank(branch.name)) {
            merged.name = fallback ? branch.name : parent.name + " :: " + branch.name;
        }
        if (!isBlank(branch.method)) {
            merged.method = branch.method;
        }
        if (!isBlank(branch.path)) {
            merged.path = branch.path;
            merged.url = null;
        }
        if (!isBlank(branch.url)) {
            merged.url = branch.url;
        }
        if (!isBlank(branch.customHookRef)) {
            merged.customHookRef = branch.customHookRef;
        }
        if (!isBlank(branch.customHookName)) {
            merged.customHookName = branch.customHookName;
        }
        if (branch.headers != null && !branch.headers.isEmpty()) {
            merged.headers = copyMap(parent.headers);
            merged.headers.putAll(branch.headers);
        }
        if (branch.queryParams != null && !branch.queryParams.isEmpty()) {
            merged.queryParams = new LinkedHashMap<>(copyMap(parent.queryParams));
            merged.queryParams.putAll(branch.queryParams);
        }
        if (branch.formParams != null && !branch.formParams.isEmpty()) {
            merged.formParams = new LinkedHashMap<>(copyMap(parent.formParams));
            merged.formParams.putAll(branch.formParams);
        }
        if (branch.body != null) {
            merged.body = branch.body;
            merged.bodyFile = null;
        }
        if (branch.bodyFile != null) {
            merged.bodyFile = branch.bodyFile;
            merged.body = null;
        }
        if (branch.bodyType != null) {
            merged.bodyType = branch.bodyType;
        }
        if (branch.formUploads != null && !branch.formUploads.isEmpty()) {
            merged.formUploads = copyUploads(branch.formUploads);
        }
        if (branch.auth != null) {
            merged.auth = copyAuth(branch.auth);
        }
        if (branch.disableFollowRedirect != null) {
            merged.disableFollowRedirect = branch.disableFollowRedirect;
        }
        if (branch.disableUrlEncoding != null) {
            merged.disableUrlEncoding = branch.disableUrlEncoding;
        }
        if (branch.silent != null) {
            merged.silent = branch.silent;
        }
        if (branch.ignoreProtocolHeaders != null) {
            merged.ignoreProtocolHeaders = branch.ignoreProtocolHeaders;
        }
        if (branch.requestTimeoutMs != null) {
            merged.requestTimeoutMs = branch.requestTimeoutMs;
        }
        if (branch.retryCount != null) {
            merged.retryCount = branch.retryCount;
        }
        if (branch.expectedStatus != null) {
            merged.expectedStatus = branch.expectedStatus;
        }
        if (branch.pauseMs != null) {
            merged.pauseMs = branch.pauseMs;
        }
        if (branch.checks != null && !branch.checks.isEmpty()) {
            merged.checks = copyChecks(branch.checks);
        }
        if (branch.captures != null && !branch.captures.isEmpty()) {
            merged.captures = copyCaptures(branch.captures);
        }
        return merged;
    }

    private Session applyStepHookBefore(Session session, ConfigModels.RequestStep step) {
        StepHookExtension hook = resolveStepHook(step);
        return hook == null ? session : hook.before(session, step);
    }

    private Session applyStepHookAfter(Session session, ConfigModels.RequestStep step) {
        StepHookExtension hook = resolveStepHook(step);
        return hook == null ? session : hook.after(session, step);
    }

    private StepHookExtension resolveStepHook(ConfigModels.RequestStep step) {
        if (step == null || isBlank(step.customHookRef)) {
            if (step == null || isBlank(step.customHookName)) {
                return null;
            }
            String generatedRef = "com.example.gatling.generated.hooks." + step.customHookName.trim();
            return stepHookCache.computeIfAbsent(generatedRef, this::instantiateHook);
        }
        return stepHookCache.computeIfAbsent(step.customHookRef, this::instantiateHook);
    }

    private StepHookExtension instantiateHook(String className) {
        try {
            Class<?> clazz = Class.forName(className);
            Object instance = clazz.getDeclaredConstructor().newInstance();
            if (!(instance instanceof StepHookExtension)) {
                throw new IllegalArgumentException("Hook class does not implement StepHookExtension: " + className);
            }
            return (StepHookExtension) instance;
        } catch (Exception ex) {
            throw new IllegalArgumentException("Failed to load customHookRef: " + className, ex);
        }
    }

    private Map<String, String> copyMap(Map<String, String> source) {
        return source == null ? new LinkedHashMap<>() : new LinkedHashMap<>(source);
    }

    private List<ConfigModels.FormUploadConfig> copyUploads(List<ConfigModels.FormUploadConfig> source) {
        if (source == null) {
            return null;
        }
        List<ConfigModels.FormUploadConfig> copy = new ArrayList<>();
        for (ConfigModels.FormUploadConfig upload : source) {
            if (upload == null) {
                continue;
            }
            ConfigModels.FormUploadConfig item = new ConfigModels.FormUploadConfig();
            item.fieldName = upload.fieldName;
            item.filePath = upload.filePath;
            copy.add(item);
        }
        return copy;
    }

    private List<ConfigModels.CheckConfig> copyChecks(List<ConfigModels.CheckConfig> source) {
        if (source == null) {
            return null;
        }
        List<ConfigModels.CheckConfig> copy = new ArrayList<>();
        for (ConfigModels.CheckConfig check : source) {
            if (check == null) {
                continue;
            }
            ConfigModels.CheckConfig item = new ConfigModels.CheckConfig();
            item.type = check.type;
            item.path = check.path;
            item.value = check.value;
            copy.add(item);
        }
        return copy;
    }

    private List<ConfigModels.CaptureConfig> copyCaptures(List<ConfigModels.CaptureConfig> source) {
        if (source == null) {
            return null;
        }
        List<ConfigModels.CaptureConfig> copy = new ArrayList<>();
        for (ConfigModels.CaptureConfig capture : source) {
            if (capture == null) {
                continue;
            }
            ConfigModels.CaptureConfig item = new ConfigModels.CaptureConfig();
            item.type = capture.type;
            item.path = capture.path;
            item.saveAs = capture.saveAs;
            copy.add(item);
        }
        return copy;
    }

    private ConfigModels.AuthConfig copyAuth(ConfigModels.AuthConfig auth) {
        if (auth == null) {
            return null;
        }
        ConfigModels.AuthConfig copy = new ConfigModels.AuthConfig();
        copy.type = auth.type;
        copy.tokenEnv = auth.tokenEnv;
        copy.usernameEnv = auth.usernameEnv;
        copy.passwordEnv = auth.passwordEnv;
        copy.headerName = auth.headerName;
        copy.headerValueEnv = auth.headerValueEnv;
        return copy;
    }

    private static final class BranchCandidate {
        private final String conditionExpression;
        private final ConfigModels.RequestStep step;

        private BranchCandidate(String conditionExpression, ConfigModels.RequestStep step) {
            this.conditionExpression = conditionExpression;
            this.step = step;
        }
    }

    private ConfigModels.LoadProfile resolveLoadProfile(
            ConfigModels.LoadProfile load,
            Map<String, ConfigModels.LoadProfile> injectionProfiles
    ) {
        if (load == null) {
            throw new IllegalArgumentException("Scenario load is required.");
        }
        if (load.profileRef == null || load.profileRef.isBlank()) {
            return load;
        }
        if (injectionProfiles == null || !injectionProfiles.containsKey(load.profileRef)) {
            throw new IllegalArgumentException("Injection profile not found: " + load.profileRef);
        }
        ConfigModels.LoadProfile fromProfile = injectionProfiles.get(load.profileRef);
        if (fromProfile == null) {
            throw new IllegalArgumentException("Injection profile is null: " + load.profileRef);
        }
        return fromProfile;
    }

    private String inferInjectionType(ConfigModels.LoadProfile load) {
        if (load.durationSec != null && load.paceMs != null && load.users != null) {
            return "pacedusers";
        }
        return "rampusers";
    }

    private ConfigModels.ServiceConfig resolveService(ConfigModels.TestPlan testPlan) {
        ConfigModels.ServiceConfig base = testPlan.service;
        if (testPlan.activeEnvironment == null || testPlan.activeEnvironment.isBlank()
                || testPlan.environments == null || testPlan.environments.isEmpty()) {
            return base;
        }

        ConfigModels.ServiceConfig env = testPlan.environments.get(testPlan.activeEnvironment);
        if (env == null) {
            throw new IllegalArgumentException("activeEnvironment not found: " + testPlan.activeEnvironment);
        }

        ConfigModels.ServiceConfig merged = new ConfigModels.ServiceConfig();
        merged.baseUrl = isBlank(env.baseUrl) ? base.baseUrl : env.baseUrl;
        merged.defaultHeaders = new HashMap<>();
        if (base.defaultHeaders != null) {
            merged.defaultHeaders.putAll(base.defaultHeaders);
        }
        if (env.defaultHeaders != null) {
            merged.defaultHeaders.putAll(env.defaultHeaders);
        }
        merged.auth = mergeAuth(base.auth, env.auth);
        merged.tls = mergeTls(base.tls, env.tls);
        return merged;
    }

    private ConfigModels.ServiceConfig resolveServiceForApp(ConfigModels.ApplicationConfig app) {
        ConfigModels.ServiceConfig base = app.service;
        if (app.activeEnvironment == null || app.activeEnvironment.isBlank()
                || app.environments == null || app.environments.isEmpty()) {
            return base;
        }
        ConfigModels.ServiceConfig env = app.environments.get(app.activeEnvironment);
        if (env == null) {
            throw new IllegalArgumentException("activeEnvironment not found for app: " + app.activeEnvironment);
        }
        ConfigModels.ServiceConfig merged = new ConfigModels.ServiceConfig();
        merged.baseUrl = isBlank(env.baseUrl) ? base.baseUrl : env.baseUrl;
        merged.defaultHeaders = new HashMap<>();
        if (base.defaultHeaders != null) {
            merged.defaultHeaders.putAll(base.defaultHeaders);
        }
        if (env.defaultHeaders != null) {
            merged.defaultHeaders.putAll(env.defaultHeaders);
        }
        merged.auth = mergeAuth(base.auth, env.auth);
        merged.tls = mergeTls(base.tls, env.tls);
        return merged;
    }

    private ConfigModels.AuthConfig mergeAuth(ConfigModels.AuthConfig base, ConfigModels.AuthConfig env) {
        if (base == null && env == null) {
            return null;
        }
        if (env == null) {
            return base;
        }
        ConfigModels.AuthConfig merged = new ConfigModels.AuthConfig();
        merged.type = isBlank(env.type) && base != null ? base.type : env.type;
        merged.tokenEnv = isBlank(env.tokenEnv) && base != null ? base.tokenEnv : env.tokenEnv;
        return merged;
    }

    private ConfigModels.TlsConfig mergeTls(ConfigModels.TlsConfig base, ConfigModels.TlsConfig env) {
        if (base == null && env == null) {
            return null;
        }
        if (env == null) {
            return base;
        }
        ConfigModels.TlsConfig merged = new ConfigModels.TlsConfig();
        merged.enabled = env.enabled != null ? env.enabled : (base != null ? base.enabled : null);
        merged.keyStorePath = pick(env.keyStorePath, base == null ? null : base.keyStorePath);
        merged.keyStoreType = pick(env.keyStoreType, base == null ? null : base.keyStoreType);
        merged.keyStorePasswordEnv = pick(env.keyStorePasswordEnv, base == null ? null : base.keyStorePasswordEnv);
        merged.trustStorePath = pick(env.trustStorePath, base == null ? null : base.trustStorePath);
        merged.trustStoreType = pick(env.trustStoreType, base == null ? null : base.trustStoreType);
        merged.trustStorePasswordEnv = pick(env.trustStorePasswordEnv, base == null ? null : base.trustStorePasswordEnv);
        merged.insecureSkipTlsVerify = env.insecureSkipTlsVerify != null
                ? env.insecureSkipTlsVerify
                : (base != null ? base.insecureSkipTlsVerify : null);
        return merged;
    }

    private String pick(String preferred, String fallback) {
        return isBlank(preferred) ? fallback : preferred;
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private HttpProtocolBuilder buildHttpProtocol(ConfigModels.ServiceConfig serviceConfig) {
        applyTlsConfig(serviceConfig.tls);
        HttpProtocolBuilder protocol = http.baseUrl(serviceConfig.baseUrl);
        Map<String, String> mergedHeaders = new HashMap<>();
        if (serviceConfig.defaultHeaders != null) {
            mergedHeaders.putAll(serviceConfig.defaultHeaders);
        }
        applyAuthHeaders(mergedHeaders, serviceConfig.auth, "service auth");

        if (!mergedHeaders.isEmpty()) {
            protocol = protocol.headers(mergedHeaders);
        }
        return protocol;
    }

    private void applyTlsConfig(ConfigModels.TlsConfig tls) {
        if (tls == null || !Boolean.TRUE.equals(tls.enabled)) {
            return;
        }
        if (tls.keyStorePath != null && !tls.keyStorePath.isBlank()) {
            System.setProperty("javax.net.ssl.keyStore", tls.keyStorePath);
            if (tls.keyStoreType != null && !tls.keyStoreType.isBlank()) {
                System.setProperty("javax.net.ssl.keyStoreType", tls.keyStoreType);
            }
            String ksEnv = tls.keyStorePasswordEnv;
            if (ksEnv != null && !ksEnv.isBlank()) {
                String pwd = System.getenv(ksEnv);
                if (pwd == null || pwd.isBlank()) {
                    throw new IllegalArgumentException("Missing keyStore password env var: " + ksEnv);
                }
                System.setProperty("javax.net.ssl.keyStorePassword", pwd);
            }
        }
        if (tls.trustStorePath != null && !tls.trustStorePath.isBlank()) {
            System.setProperty("javax.net.ssl.trustStore", tls.trustStorePath);
            if (tls.trustStoreType != null && !tls.trustStoreType.isBlank()) {
                System.setProperty("javax.net.ssl.trustStoreType", tls.trustStoreType);
            }
            String tsEnv = tls.trustStorePasswordEnv;
            if (tsEnv != null && !tsEnv.isBlank()) {
                String pwd = System.getenv(tsEnv);
                if (pwd == null || pwd.isBlank()) {
                    throw new IllegalArgumentException("Missing trustStore password env var: " + tsEnv);
                }
                System.setProperty("javax.net.ssl.trustStorePassword", pwd);
            }
        }
        if (Boolean.TRUE.equals(tls.insecureSkipTlsVerify)) {
            System.setProperty("io.netty.handler.ssl.noOpenSsl", "true");
            System.setProperty("jdk.internal.httpclient.disableHostnameVerification", "true");
        }
    }

    private HttpRequestActionBuilder buildRequest(ConfigModels.RequestStep step) {
        String method = step.method.toUpperCase(Locale.ROOT);
        String target = isBlank(step.url) ? step.path : step.url;
        HttpRequestActionBuilder request;
        switch (method) {
            case "GET":
                request = http(step.name).get(target);
                break;
            case "POST":
                request = http(step.name).post(target);
                break;
            case "PUT":
                request = http(step.name).put(target);
                break;
            case "PATCH":
                request = http(step.name).patch(target);
                break;
            case "DELETE":
                request = http(step.name).delete(target);
                break;
            case "HEAD":
                request = http(step.name).head(target);
                break;
            case "OPTIONS":
                request = http(step.name).options(target);
                break;
            default:
                throw new IllegalArgumentException("Unsupported method: " + step.method + " in step: " + step.name);
        }

        Map<String, String> requestHeaders = new HashMap<>();
        if (step.headers != null && !step.headers.isEmpty()) {
            requestHeaders.putAll(step.headers);
        }
        applyAuthHeaders(requestHeaders, step.auth, "step auth for " + step.name);
        if (!requestHeaders.isEmpty()) {
            request = request.headers(requestHeaders);
        }
        request = applyRequestOptions(request, step);
        request = applyRequestPayload(request, step, requestHeaders);
        if (step.expectedStatus != null) {
            request = request.check(status().is(step.expectedStatus));
        } else {
            request = request.check(status().in(200, 201, 202, 203, 204, 205, 206, 207, 208, 226));
        }
        if (step.checks != null) {
            for (ConfigModels.CheckConfig check : step.checks) {
                request = applyCheck(request, check, step.name);
            }
        }
        if (step.captures != null) {
            for (ConfigModels.CaptureConfig capture : step.captures) {
                request = applyCapture(request, capture, step.name);
            }
        }
        return request;
    }

    private HttpRequestActionBuilder applyRequestOptions(HttpRequestActionBuilder request, ConfigModels.RequestStep step) {
        if (step.queryParams != null) {
            for (var entry : step.queryParams.entrySet()) {
                if (!isBlank(entry.getKey())) {
                    request = request.queryParam(entry.getKey(), entry.getValue() == null ? "" : entry.getValue());
                }
            }
        }
        if (Boolean.TRUE.equals(step.disableFollowRedirect)) {
            request = request.disableFollowRedirect();
        }
        if (Boolean.TRUE.equals(step.disableUrlEncoding)) {
            request = request.disableUrlEncoding();
        }
        if (Boolean.TRUE.equals(step.silent)) {
            request = request.silent();
        }
        if (Boolean.TRUE.equals(step.ignoreProtocolHeaders)) {
            request = request.ignoreProtocolHeaders();
        }
        if (step.requestTimeoutMs != null && step.requestTimeoutMs > 0) {
            request = request.requestTimeout(Duration.ofMillis(step.requestTimeoutMs));
        }
        return request;
    }

    private HttpRequestActionBuilder applyRequestPayload(
            HttpRequestActionBuilder request,
            ConfigModels.RequestStep step,
            Map<String, String> requestHeaders
    ) {
        boolean hasUploads = step.formUploads != null && !step.formUploads.isEmpty();
        boolean hasFormParams = step.formParams != null && !step.formParams.isEmpty();

        if (hasFormParams) {
            for (var entry : step.formParams.entrySet()) {
                if (!isBlank(entry.getKey())) {
                    request = request.formParam(entry.getKey(), entry.getValue() == null ? "" : entry.getValue());
                }
            }
        }
        if (hasUploads) {
            for (ConfigModels.FormUploadConfig upload : step.formUploads) {
                request = request.formUpload(upload.fieldName, upload.filePath);
            }
        }
        if (hasUploads || "multipart".equalsIgnoreCase(step.bodyType)) {
            if (!hasHeader(requestHeaders, "Content-Type")) {
                request = request.asMultipartForm();
            }
            return request;
        }
        if (hasFormParams || "form".equalsIgnoreCase(step.bodyType)) {
            if (!hasHeader(requestHeaders, "Content-Type")) {
                request = request.asFormUrlEncoded();
            }
            return request;
        }

        String payload = null;
        if (!isBlank(step.bodyFile)) {
            payload = readBodyFile(step.bodyFile);
        } else if (!isBlank(step.body)) {
            payload = step.body;
        }

        if (payload == null) {
            return request;
        }

        request = request.body(StringBody(payload));
        String bodyType = isBlank(step.bodyType) ? "json" : step.bodyType.trim().toLowerCase(Locale.ROOT);
        if (!hasHeader(requestHeaders, "Content-Type")) {
            switch (bodyType) {
                case "json":
                    request = request.header("Content-Type", "application/json");
                    break;
                case "xml":
                    request = request.header("Content-Type", "application/xml");
                    break;
                case "text":
                    request = request.header("Content-Type", "text/plain");
                    break;
                default:
                    break;
            }
        }
        return request;
    }

    private String readBodyFile(String path) {
        try {
            return Files.readString(Path.of(path), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalArgumentException("Failed to read bodyFile: " + path, e);
        }
    }

    private boolean hasHeader(Map<String, String> headers, String name) {
        for (String key : headers.keySet()) {
            if (name.equalsIgnoreCase(key)) {
                return true;
            }
        }
        return false;
    }

    private void applyAuthHeaders(Map<String, String> headers, ConfigModels.AuthConfig auth, String label) {
        if (auth == null || isBlank(auth.type)) {
            return;
        }
        String type = auth.type.trim().toLowerCase(Locale.ROOT);
        switch (type) {
            case "bearer":
                headers.put("Authorization", "Bearer " + requireEnv(auth.tokenEnv, label));
                break;
            case "basic":
                String creds = requireEnv(auth.usernameEnv, label) + ":" + requireEnv(auth.passwordEnv, label);
                headers.put("Authorization", "Basic " + Base64.getEncoder().encodeToString(creds.getBytes(StandardCharsets.UTF_8)));
                break;
            case "header":
                headers.put(auth.headerName, requireEnv(auth.headerValueEnv, label));
                break;
            default:
                throw new IllegalArgumentException("Unsupported auth type: " + auth.type + " at " + label);
        }
    }

    private String requireEnv(String envName, String label) {
        String value = System.getenv(envName);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing required env var for " + label + ": " + envName);
        }
        return value;
    }

    private HttpRequestActionBuilder applyCheck(
            HttpRequestActionBuilder request,
            ConfigModels.CheckConfig check,
            String stepName
    ) {
        String type = check.type.toLowerCase(Locale.ROOT);
        switch (type) {
            case "bodycontains":
                return request.check(substring(check.value).exists());
            case "regex":
                return request.check(regex(check.value).exists());
            case "jsonpathexists":
                return request.check(jsonPath(check.path).exists());
            case "jsonpathequals":
                return request.check(jsonPath(check.path).is(check.value));
            case "headerexists":
                return request.check(header(check.path).exists());
            case "headerequals":
                return request.check(header(check.path).is(check.value));
            case "bodylengthgt":
                return request.check(bodyLength().gt(Integer.parseInt(check.value.trim())));
            case "jmespathexists":
                return request.check(jmesPath(check.path).exists());
            case "jmespathequals":
                return request.check(jmesPath(check.path).is(check.value));
            case "statusin":
                return request.check(status().in(parseStatuses(check.value)));
            default:
                throw new IllegalArgumentException("Unsupported check type: " + check.type + " in step: " + stepName);
        }
    }

    private HttpRequestActionBuilder applyCapture(
            HttpRequestActionBuilder request,
            ConfigModels.CaptureConfig capture,
            String stepName
    ) {
        String type = capture.type.toLowerCase(Locale.ROOT);
        if ("jsonpath".equals(type)) {
            return request.check(jsonPath(capture.path).saveAs(capture.saveAs));
        }
        if ("header".equals(type)) {
            return request.check(header(capture.path).saveAs(capture.saveAs));
        }
        if ("regex".equals(type)) {
            return request.check(regex(capture.path).saveAs(capture.saveAs));
        }
        throw new IllegalArgumentException("Unsupported capture type: " + capture.type + " in step: " + stepName);
    }

    private Integer[] parseStatuses(String csvStatuses) {
        String[] parts = csvStatuses.split(",");
        List<Integer> values = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                values.add(Integer.parseInt(trimmed));
            }
        }
        if (values.isEmpty()) {
            throw new IllegalArgumentException("statusIn requires at least one status code.");
        }
        return values.toArray(new Integer[0]);
    }

    private ScenarioBuilder applyFeeder(ScenarioBuilder scn, ConfigModels.FeederConfig feeder) {
        String mode = feeder.mode == null ? "queue" : feeder.mode.toLowerCase(Locale.ROOT);
        switch (mode) {
            case "circular":
                return scn.feed(csv(feeder.file).circular());
            case "random":
                return scn.feed(csv(feeder.file).random());
            default:
                return scn.feed(csv(feeder.file));
        }
    }

    private List<Assertion> buildAssertions(ConfigModels.AssertionsConfig assertionsConfig) {
        List<Assertion> assertions = new ArrayList<>();
        if (assertionsConfig == null) {
            return assertions;
        }
        if (assertionsConfig.minSuccessPercent != null) {
            assertions.add(global().successfulRequests().percent().gte(assertionsConfig.minSuccessPercent));
        }
        if (assertionsConfig.maxResponseTimeMs != null) {
            assertions.add(global().responseTime().max().lte(assertionsConfig.maxResponseTimeMs));
        }
        if (assertionsConfig.p90ResponseTimeMs != null) {
            assertions.add(global().responseTime().percentile(90.0).lte(assertionsConfig.p90ResponseTimeMs));
        }
        if (assertionsConfig.p95ResponseTimeMs != null) {
            assertions.add(global().responseTime().percentile3().lte(assertionsConfig.p95ResponseTimeMs));
        }
        if (assertionsConfig.p99ResponseTimeMs != null) {
            assertions.add(global().responseTime().percentile(99.0).lte(assertionsConfig.p99ResponseTimeMs));
        }
        if (assertionsConfig.maxFailedRequests != null) {
            assertions.add(global().failedRequests().count().lte(assertionsConfig.maxFailedRequests.longValue()));
        }
        if (assertionsConfig.minRequestsPerSec != null) {
            assertions.add(global().requestsPerSec().gte(assertionsConfig.minRequestsPerSec));
        }
        return assertions;
    }

    private List<Assertion> buildScopedAssertionsForApp(
            String appName,
            List<ConfigModels.ScenarioConfig> scenarios,
            ConfigModels.AssertionsConfig assertionsConfig
    ) {
        List<Assertion> assertions = new ArrayList<>();
        if (scenarios == null || scenarios.isEmpty() || assertionsConfig == null) {
            return assertions;
        }
        for (ConfigModels.ScenarioConfig scenarioConfig : scenarios) {
            String scopedScenarioName = appName + " :: " + scenarioConfig.name;
            if (assertionsConfig.minSuccessPercent != null) {
                assertions.add(details(scopedScenarioName).successfulRequests().percent().gte(assertionsConfig.minSuccessPercent));
            }
            if (assertionsConfig.maxResponseTimeMs != null) {
                assertions.add(details(scopedScenarioName).responseTime().max().lte(assertionsConfig.maxResponseTimeMs));
            }
            if (assertionsConfig.p90ResponseTimeMs != null) {
                assertions.add(details(scopedScenarioName).responseTime().percentile(90.0).lte(assertionsConfig.p90ResponseTimeMs));
            }
            if (assertionsConfig.p95ResponseTimeMs != null) {
                assertions.add(details(scopedScenarioName).responseTime().percentile3().lte(assertionsConfig.p95ResponseTimeMs));
            }
            if (assertionsConfig.p99ResponseTimeMs != null) {
                assertions.add(details(scopedScenarioName).responseTime().percentile(99.0).lte(assertionsConfig.p99ResponseTimeMs));
            }
            if (assertionsConfig.maxFailedRequests != null) {
                assertions.add(details(scopedScenarioName).failedRequests().count().lte(assertionsConfig.maxFailedRequests.longValue()));
            }
            if (assertionsConfig.minRequestsPerSec != null) {
                assertions.add(details(scopedScenarioName).requestsPerSec().gte(assertionsConfig.minRequestsPerSec));
            }
        }
        return assertions;
    }
}
