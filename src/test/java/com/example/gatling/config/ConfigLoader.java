package com.example.gatling.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class ConfigLoader {
    private ConfigLoader() {
    }

    public static ConfigModels.TestPlan load(String path) {
        try {
            Path configPath = Path.of(path);
            if (!Files.exists(configPath)) {
                throw new IllegalArgumentException("Config file not found: " + path);
            }

            YAMLMapper mapper = YAMLMapper.builder()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .build();

            ConfigModels.TestPlan plan = mapper.readValue(configPath.toFile(), ConfigModels.TestPlan.class);
            validate(plan);
            return plan;
        } catch (IOException e) {
            throw new RuntimeException("Failed to read config: " + path, e);
        }
    }

    private static void validate(ConfigModels.TestPlan plan) {
        if (plan == null) {
            throw new IllegalArgumentException("Config is empty.");
        }
        if (plan.applications != null && !plan.applications.isEmpty()) {
            validateApplicationsMode(plan);
            return;
        }

        validateLegacyMode(plan);
    }

    private static void validateApplicationsMode(ConfigModels.TestPlan plan) {
        for (var entry : plan.applications.entrySet()) {
            String appName = entry.getKey();
            ConfigModels.ApplicationConfig app = entry.getValue();
            if (isBlank(appName)) {
                throw new IllegalArgumentException("Application name cannot be blank.");
            }
            if (app == null) {
                throw new IllegalArgumentException("Application config cannot be null: " + appName);
            }
            if (app.service == null) {
                throw new IllegalArgumentException("applications." + appName + ".service is required.");
            }
            boolean hasEnvMode = !isBlank(app.activeEnvironment)
                    && app.environments != null
                    && !app.environments.isEmpty();
            validateService("applications." + appName + ".service", app.service, hasEnvMode);

            if (app.environments != null && !app.environments.isEmpty()) {
                for (var envEntry : app.environments.entrySet()) {
                    String envName = envEntry.getKey();
                    ConfigModels.ServiceConfig envService = envEntry.getValue();
                    if (isBlank(envName)) {
                        throw new IllegalArgumentException("applications." + appName + ".environments key cannot be blank.");
                    }
                    if (envService == null) {
                        throw new IllegalArgumentException("applications." + appName + ".environments." + envName + " cannot be null.");
                    }
                    validateService("applications." + appName + ".environments." + envName, envService, true);
                }
            }
            if (!isBlank(app.activeEnvironment)) {
                if (app.environments == null || !app.environments.containsKey(app.activeEnvironment)) {
                    throw new IllegalArgumentException("applications." + appName + ".activeEnvironment not found in environments: " + app.activeEnvironment);
                }
                ConfigModels.ServiceConfig envService = app.environments.get(app.activeEnvironment);
                String envBaseUrl = envService == null ? null : envService.baseUrl;
                if (isBlank(envBaseUrl) && isBlank(app.service.baseUrl)) {
                    throw new IllegalArgumentException("applications." + appName + " requires baseUrl in service or active environment.");
                }
            }
            if (isBlank(app.service.baseUrl) && (isBlank(app.activeEnvironment) || app.environments == null)) {
                throw new IllegalArgumentException("applications." + appName + ".service.baseUrl is required when no active environment is configured.");
            }
            validateInjectionProfiles(app.injectionProfiles, "applications." + appName + ".injectionProfiles");
            validateScenarios(app.scenarios, app.injectionProfiles, "applications." + appName);
            validateAssertions(app.assertions, "applications." + appName + ".assertions");
        }
    }

    private static void validateLegacyMode(ConfigModels.TestPlan plan) {
        if (plan.service == null) {
            throw new IllegalArgumentException("service is required.");
        }
        boolean hasEnvMode = !isBlank(plan.activeEnvironment)
                && plan.environments != null
                && !plan.environments.isEmpty();
        validateService("service", plan.service, hasEnvMode);

        if (plan.environments != null && !plan.environments.isEmpty()) {
            for (var entry : plan.environments.entrySet()) {
                String envName = entry.getKey();
                ConfigModels.ServiceConfig envService = entry.getValue();
                if (isBlank(envName)) {
                    throw new IllegalArgumentException("Environment name cannot be blank.");
                }
                if (envService == null) {
                    throw new IllegalArgumentException("Environment config cannot be null for: " + envName);
                }
                validateService("environments." + envName, envService, true);
            }
        }
        if (!isBlank(plan.activeEnvironment)) {
            if (plan.environments == null || !plan.environments.containsKey(plan.activeEnvironment)) {
                throw new IllegalArgumentException("activeEnvironment not found in environments: " + plan.activeEnvironment);
            }
            ConfigModels.ServiceConfig envService = plan.environments.get(plan.activeEnvironment);
            String envBaseUrl = envService == null ? null : envService.baseUrl;
            if (isBlank(envBaseUrl) && isBlank(plan.service.baseUrl)) {
                throw new IllegalArgumentException("baseUrl must be set in service or active environment: " + plan.activeEnvironment);
            }
        }

        if (isBlank(plan.service.baseUrl) && (isBlank(plan.activeEnvironment) || plan.environments == null)) {
            throw new IllegalArgumentException("service.baseUrl is required when no activeEnvironment is configured.");
        }
        validateScenarios(plan.scenarios, null, "");
        validateAssertions(plan.assertions, "assertions");
    }

    private static void validateInjectionProfiles(Map<String, ConfigModels.LoadProfile> injectionProfiles, String label) {
        if (injectionProfiles == null) {
            return;
        }
        for (var entry : injectionProfiles.entrySet()) {
            String name = entry.getKey();
            if (isBlank(name)) {
                throw new IllegalArgumentException(label + " key cannot be blank.");
            }
            validateLoadProfile(entry.getValue(), label + "." + name);
        }
    }

    private static void validateScenarios(
            java.util.List<ConfigModels.ScenarioConfig> scenarios,
            Map<String, ConfigModels.LoadProfile> injectionProfiles,
            String prefix
    ) {
        if (scenarios == null || scenarios.isEmpty()) {
            throw new IllegalArgumentException("At least one scenario is required.");
        }
        for (ConfigModels.ScenarioConfig scenario : scenarios) {
            if (isBlank(scenario.name)) {
                throw new IllegalArgumentException("scenario.name is required.");
            }
            if (scenario.load == null) {
                throw new IllegalArgumentException("scenario.load is required for scenario: " + scenario.name);
            }
            if (!isBlank(scenario.load.profileRef)) {
                if (injectionProfiles == null || !injectionProfiles.containsKey(scenario.load.profileRef)) {
                    throw new IllegalArgumentException("scenario.load.profileRef not found: " + scenario.load.profileRef + " in scenario: " + scenario.name);
                }
                validateLoadProfile(injectionProfiles.get(scenario.load.profileRef), "injectionProfile." + scenario.load.profileRef);
            } else {
                validateLoadProfile(scenario.load, "scenario.load for scenario: " + scenario.name);
            }
            if (scenario.feeder != null) {
                if (isBlank(scenario.feeder.type) || isBlank(scenario.feeder.file)) {
                    throw new IllegalArgumentException("scenario.feeder requires type and file for scenario: " + scenario.name);
                }
                if (!"csv".equalsIgnoreCase(scenario.feeder.type)) {
                    throw new IllegalArgumentException("Only feeder.type=csv is supported currently for scenario: " + scenario.name);
                }
            }
            if (scenario.flow != null) {
                if (scenario.flow.repeatCount != null && scenario.flow.repeatCount <= 0) {
                    throw new IllegalArgumentException("scenario.flow.repeatCount must be > 0 for scenario: " + scenario.name);
                }
                if (scenario.flow.duringSec != null && scenario.flow.duringSec <= 0) {
                    throw new IllegalArgumentException("scenario.flow.duringSec must be > 0 for scenario: " + scenario.name);
                }
                if ((!isBlank(scenario.flow.asLongAsVariable) && scenario.flow.asLongAsEquals == null)
                        || (isBlank(scenario.flow.asLongAsVariable) && scenario.flow.asLongAsEquals != null)) {
                    throw new IllegalArgumentException("scenario.flow.asLongAsVariable and asLongAsEquals must be provided together for scenario: " + scenario.name);
                }
            }
            if (scenario.steps == null || scenario.steps.isEmpty()) {
                throw new IllegalArgumentException("scenario.steps must contain at least one step for scenario: " + scenario.name);
            }
            for (ConfigModels.RequestStep step : scenario.steps) {
                if (isBlank(step.name) || isBlank(step.method)) {
                    throw new IllegalArgumentException(
                            "Each step requires name and method. Invalid step in scenario: " + scenario.name
                    );
                }
                if (isBlank(step.path) && isBlank(step.url)) {
                    throw new IllegalArgumentException(
                            "Each step requires path or url. Invalid step in scenario: " + scenario.name
                    );
                }
                if (step.retryCount != null && step.retryCount < 0) {
                    throw new IllegalArgumentException("step.retryCount must be >= 0 in scenario: " + scenario.name);
                }
                if (!isBlank(step.body) && !isBlank(step.bodyFile)) {
                    throw new IllegalArgumentException("step.body and step.bodyFile cannot both be set in scenario: " + scenario.name);
                }
                if (step.requestTimeoutMs != null && step.requestTimeoutMs <= 0) {
                    throw new IllegalArgumentException("step.requestTimeoutMs must be > 0 in scenario: " + scenario.name);
                }
                if ((!isBlank(step.body) || !isBlank(step.bodyFile))
                        && step.formParams != null && !step.formParams.isEmpty()) {
                    throw new IllegalArgumentException("step.body/bodyFile cannot be combined with step.formParams in scenario: " + scenario.name);
                }
                if ((!isBlank(step.body) || !isBlank(step.bodyFile))
                        && step.formUploads != null && !step.formUploads.isEmpty()) {
                    throw new IllegalArgumentException("step.body/bodyFile cannot be combined with step.formUploads in scenario: " + scenario.name);
                }
                validateAuth(step.auth, "step.auth in scenario: " + scenario.name + ", step: " + step.name);
                validateBodyType(step.bodyType, "step.bodyType in scenario: " + scenario.name + ", step: " + step.name);
                if ("multipart".equalsIgnoreCase(step.bodyType)
                        && ((step.formUploads == null || step.formUploads.isEmpty())
                        && (step.formParams == null || step.formParams.isEmpty()))) {
                    throw new IllegalArgumentException("step.bodyType=multipart requires formUploads or formParams in scenario: " + scenario.name);
                }
                if (step.formUploads != null) {
                    for (ConfigModels.FormUploadConfig upload : step.formUploads) {
                        if (upload == null || isBlank(upload.fieldName) || isBlank(upload.filePath)) {
                            throw new IllegalArgumentException("step.formUploads[] requires fieldName and filePath in scenario: " + scenario.name);
                        }
                    }
                }
                validateCondition(step.condition, "step.condition", scenario.name);
                if (step.branches != null) {
                    for (int i = 0; i < step.branches.size(); i++) {
                        ConfigModels.ConditionalBranchConfig branch = step.branches.get(i);
                        validateBranch(step, branch, scenario.name, "step.branches[" + i + "]", true);
                    }
                }
                if (step.fallback != null) {
                    validateBranch(step, step.fallback, scenario.name, "step.fallback", false);
                }
                boolean hasElse = !isBlank(step.elseMethod) || !isBlank(step.elsePath) || !isBlank(step.elseBody) || step.elseExpectedStatus != null;
                if (hasElse) {
                    if (!hasCompleteLegacyCondition(step.condition)) {
                        throw new IllegalArgumentException("step else branch requires step.condition in scenario: " + scenario.name);
                    }
                    if (isBlank(step.elseMethod) || isBlank(step.elsePath)) {
                        throw new IllegalArgumentException("step else branch requires elseMethod and elsePath in scenario: " + scenario.name);
                    }
                }
                if (step.checks != null) {
                    for (ConfigModels.CheckConfig check : step.checks) {
                        if (isBlank(check.type)) {
                            throw new IllegalArgumentException("step.checks[].type is required in scenario: " + scenario.name);
                        }
                        String type = check.type.trim().toLowerCase();
                        switch (type) {
                            case "bodycontains":
                            case "regex":
                                if (isBlank(check.value)) {
                                    throw new IllegalArgumentException("step.checks[].value is required for type=" + check.type);
                                }
                                break;
                            case "jsonpathexists":
                                if (isBlank(check.path)) {
                                    throw new IllegalArgumentException("step.checks[].path is required for type=" + check.type);
                                }
                                break;
                            case "jsonpathequals":
                                if (isBlank(check.path) || isBlank(check.value)) {
                                    throw new IllegalArgumentException("step.checks[].path and value are required for type=" + check.type);
                                }
                                break;
                            case "headerexists":
                                if (isBlank(check.path)) {
                                    throw new IllegalArgumentException("step.checks[].path(header name) is required for type=" + check.type);
                                }
                                break;
                            case "headerequals":
                                if (isBlank(check.path) || isBlank(check.value)) {
                                    throw new IllegalArgumentException("step.checks[].path(header name) and value are required for type=" + check.type);
                                }
                                break;
                            case "bodylengthgt":
                                if (isBlank(check.value)) {
                                    throw new IllegalArgumentException("step.checks[].value is required for type=" + check.type);
                                }
                                try {
                                    Integer.parseInt(check.value.trim());
                                } catch (NumberFormatException ex) {
                                    throw new IllegalArgumentException("step.checks[].value must be integer for type=" + check.type);
                                }
                                break;
                            case "jmespathexists":
                                if (isBlank(check.path)) {
                                    throw new IllegalArgumentException("step.checks[].path is required for type=" + check.type);
                                }
                                break;
                            case "jmespathequals":
                                if (isBlank(check.path) || isBlank(check.value)) {
                                    throw new IllegalArgumentException("step.checks[].path and value are required for type=" + check.type);
                                }
                                break;
                            case "statusin":
                                if (isBlank(check.value)) {
                                    throw new IllegalArgumentException("step.checks[].value is required for type=" + check.type);
                                }
                                break;
                            default:
                                throw new IllegalArgumentException("Unsupported step.checks[].type: " + check.type);
                        }
                    }
                }
                if (step.captures != null) {
                    for (ConfigModels.CaptureConfig capture : step.captures) {
                        if (isBlank(capture.type) || isBlank(capture.path) || isBlank(capture.saveAs)) {
                            throw new IllegalArgumentException("step.captures[] requires type, path, saveAs.");
                        }
                        String captureType = capture.type.trim().toLowerCase();
                        if (!"jsonpath".equals(captureType)
                                && !"header".equals(captureType)
                                && !"regex".equals(captureType)) {
                            throw new IllegalArgumentException("Unsupported step.captures[].type: " + capture.type);
                        }
                    }
                }
            }
        }
    }

    private static void validateLoadProfile(ConfigModels.LoadProfile load, String label) {
        if (load == null) {
            throw new IllegalArgumentException(label + " is required.");
        }
        String type = isBlank(load.injectionType) ? inferInjectionType(load) : load.injectionType.trim();
        switch (type.toLowerCase()) {
            case "rampusers":
                requirePositiveInt(load.users, label + ".users");
                requirePositiveInt(load.rampDurationSec, label + ".rampDurationSec");
                break;
            case "pacedusers":
                requirePositiveInt(load.users, label + ".users");
                requirePositiveInt(load.durationSec, label + ".durationSec");
                requirePositiveInt(load.paceMs, label + ".paceMs");
                break;
            case "atonceusers":
                requirePositiveInt(load.users, label + ".users");
                break;
            case "constantuserspersec":
                requirePositiveDouble(load.rate, label + ".rate");
                requirePositiveInt(load.durationSec, label + ".durationSec");
                break;
            case "rampuserspersec":
                requirePositiveDouble(load.fromRps, label + ".fromRps");
                requirePositiveDouble(load.toRps, label + ".toRps");
                requirePositiveInt(load.durationSec, label + ".durationSec");
                break;
            case "incrementuserspersec":
                requirePositiveDouble(load.incrementBy, label + ".incrementBy");
                requirePositiveInt(load.levelCount, label + ".levelCount");
                requirePositiveInt(load.levelDurationSec, label + ".levelDurationSec");
                if (load.startRate != null && load.startRate < 0) {
                    throw new IllegalArgumentException(label + ".startRate must be >= 0.");
                }
                break;
            case "constantconcurrentusers":
                requirePositiveInt(load.users, label + ".users");
                requirePositiveInt(load.durationSec, label + ".durationSec");
                break;
            case "rampconcurrentusers":
                requirePositiveInt(load.fromUsers, label + ".fromUsers");
                requirePositiveInt(load.toUsers, label + ".toUsers");
                requirePositiveInt(load.durationSec, label + ".durationSec");
                break;
            default:
                throw new IllegalArgumentException("Unsupported injectionType: " + type + " at " + label);
        }
    }

    private static String inferInjectionType(ConfigModels.LoadProfile load) {
        if (load.durationSec != null && load.paceMs != null && load.users != null) {
            return "pacedUsers";
        }
        return "rampUsers";
    }

    private static void requirePositiveInt(Integer value, String label) {
        if (value == null || value <= 0) {
            throw new IllegalArgumentException(label + " must be > 0.");
        }
    }

    private static void requirePositiveDouble(Double value, String label) {
        if (value == null || value <= 0) {
            throw new IllegalArgumentException(label + " must be > 0.");
        }
    }

    private static void validateAssertions(ConfigModels.AssertionsConfig assertions, String label) {
        if (assertions != null) {
            if (assertions.minSuccessPercent != null
                    && (assertions.minSuccessPercent < 0 || assertions.minSuccessPercent > 100)) {
                throw new IllegalArgumentException(label + ".minSuccessPercent must be between 0 and 100.");
            }
            if (assertions.maxResponseTimeMs != null && assertions.maxResponseTimeMs <= 0) {
                throw new IllegalArgumentException(label + ".maxResponseTimeMs must be > 0.");
            }
            if (assertions.p95ResponseTimeMs != null && assertions.p95ResponseTimeMs <= 0) {
                throw new IllegalArgumentException(label + ".p95ResponseTimeMs must be > 0.");
            }
            if (assertions.p90ResponseTimeMs != null && assertions.p90ResponseTimeMs <= 0) {
                throw new IllegalArgumentException(label + ".p90ResponseTimeMs must be > 0.");
            }
            if (assertions.p99ResponseTimeMs != null && assertions.p99ResponseTimeMs <= 0) {
                throw new IllegalArgumentException(label + ".p99ResponseTimeMs must be > 0.");
            }
            if (assertions.maxFailedRequests != null && assertions.maxFailedRequests < 0) {
                throw new IllegalArgumentException(label + ".maxFailedRequests must be >= 0.");
            }
            if (assertions.minRequestsPerSec != null && assertions.minRequestsPerSec <= 0) {
                throw new IllegalArgumentException(label + ".minRequestsPerSec must be > 0.");
            }
        }
    }

    private static void validateService(String label, ConfigModels.ServiceConfig service, boolean allowBlankBaseUrl) {
        if (!allowBlankBaseUrl && isBlank(service.baseUrl)) {
            throw new IllegalArgumentException(label + ".baseUrl is required.");
        }
        validateAuth(service.auth, label + ".auth");
        if (service.tls != null && Boolean.TRUE.equals(service.tls.enabled)) {
            if (!isBlank(service.tls.keyStorePath) && isBlank(service.tls.keyStorePasswordEnv)) {
                throw new IllegalArgumentException(label + ".tls.keyStorePasswordEnv is required when keyStorePath is set.");
            }
            if (!isBlank(service.tls.trustStorePath) && isBlank(service.tls.trustStorePasswordEnv)) {
                throw new IllegalArgumentException(label + ".tls.trustStorePasswordEnv is required when trustStorePath is set.");
            }
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static void validateAuth(ConfigModels.AuthConfig auth, String label) {
        if (auth == null || isBlank(auth.type)) {
            return;
        }
        String type = auth.type.trim().toLowerCase();
        switch (type) {
            case "bearer":
                if (isBlank(auth.tokenEnv)) {
                    throw new IllegalArgumentException(label + ".tokenEnv is required for bearer auth.");
                }
                break;
            case "basic":
                if (isBlank(auth.usernameEnv) || isBlank(auth.passwordEnv)) {
                    throw new IllegalArgumentException(label + ".usernameEnv and passwordEnv are required for basic auth.");
                }
                break;
            case "header":
                if (isBlank(auth.headerName) || isBlank(auth.headerValueEnv)) {
                    throw new IllegalArgumentException(label + ".headerName and headerValueEnv are required for header auth.");
                }
                break;
            default:
                throw new IllegalArgumentException("Unsupported auth type at " + label + ": " + auth.type);
        }
    }

    private static void validateBodyType(String bodyType, String label) {
        if (isBlank(bodyType)) {
            return;
        }
        switch (bodyType.trim().toLowerCase()) {
            case "json":
            case "xml":
            case "text":
            case "form":
            case "multipart":
                return;
            default:
                throw new IllegalArgumentException("Unsupported bodyType at " + label + ": " + bodyType);
        }
    }

    private static void validateBranch(
            ConfigModels.RequestStep parentStep,
            ConfigModels.ConditionalBranchConfig branch,
            String scenarioName,
            String label,
            boolean requireCondition
    ) {
        if (branch == null) {
            throw new IllegalArgumentException(label + " cannot be null in scenario: " + scenarioName);
        }
        if (requireCondition) {
            validateCondition(branch.when, label + ".when", scenarioName);
            if (!isValidCondition(branch.when)) {
                throw new IllegalArgumentException(label + ".when is required in scenario: " + scenarioName);
            }
        } else if (branch.when != null) {
            validateCondition(branch.when, label + ".when", scenarioName);
        }
        validateRequestPayloadRules(
                branch.body,
                branch.bodyFile,
                branch.formParams,
                branch.formUploads,
                branch.bodyType,
                label,
                scenarioName
        );
        if (branch.requestTimeoutMs != null && branch.requestTimeoutMs <= 0) {
            throw new IllegalArgumentException(label + ".requestTimeoutMs must be > 0 in scenario: " + scenarioName);
        }
        validateAuth(branch.auth, label + ".auth in scenario: " + scenarioName + ", step: " + parentStep.name);
        validateBodyType(branch.bodyType, label + ".bodyType in scenario: " + scenarioName + ", step: " + parentStep.name);
        if ((isBlank(branch.method) && isBlank(parentStep.method))
                || (isBlank(branch.path) && isBlank(branch.url) && isBlank(parentStep.path) && isBlank(parentStep.url))) {
            throw new IllegalArgumentException(label + " must provide method and path/url directly or inherit them from the parent step in scenario: " + scenarioName);
        }
        if (branch.formUploads != null) {
            for (ConfigModels.FormUploadConfig upload : branch.formUploads) {
                if (upload == null || isBlank(upload.fieldName) || isBlank(upload.filePath)) {
                    throw new IllegalArgumentException(label + ".formUploads[] requires fieldName and filePath in scenario: " + scenarioName);
                }
            }
        }
        if (branch.checks != null) {
            for (ConfigModels.CheckConfig check : branch.checks) {
                validateCheck(check);
            }
        }
        if (branch.captures != null) {
            for (ConfigModels.CaptureConfig capture : branch.captures) {
                validateCapture(capture);
            }
        }
    }

    private static void validateRequestPayloadRules(
            String body,
            String bodyFile,
            Map<String, String> formParams,
            List<ConfigModels.FormUploadConfig> formUploads,
            String bodyType,
            String label,
            String scenarioName
    ) {
        if (!isBlank(body) && !isBlank(bodyFile)) {
            throw new IllegalArgumentException(label + ".body and " + label + ".bodyFile cannot both be set in scenario: " + scenarioName);
        }
        if ((!isBlank(body) || !isBlank(bodyFile)) && formParams != null && !formParams.isEmpty()) {
            throw new IllegalArgumentException(label + ".body/bodyFile cannot be combined with " + label + ".formParams in scenario: " + scenarioName);
        }
        if ((!isBlank(body) || !isBlank(bodyFile)) && formUploads != null && !formUploads.isEmpty()) {
            throw new IllegalArgumentException(label + ".body/bodyFile cannot be combined with " + label + ".formUploads in scenario: " + scenarioName);
        }
        if ("multipart".equalsIgnoreCase(bodyType)
                && ((formUploads == null || formUploads.isEmpty()) && (formParams == null || formParams.isEmpty()))) {
            throw new IllegalArgumentException(label + ".bodyType=multipart requires formUploads or formParams in scenario: " + scenarioName);
        }
    }

    private static void validateCondition(ConfigModels.ConditionConfig condition, String label, String scenarioName) {
        if (condition == null) {
            return;
        }
        String operator = normalizeConditionOperator(condition);
        boolean hasVariable = !isBlank(condition.variable);
        boolean hasLegacyEquals = condition.equals != null;
        boolean hasValue = !isBlank(condition.value);
        boolean hasValues = condition.values != null && !condition.values.isEmpty();
        if (!hasVariable) {
            throw new IllegalArgumentException(label + ".variable is required in scenario: " + scenarioName);
        }
        switch (operator) {
            case "equals":
            case "notequals":
            case "contains":
                if (!(hasValue || hasLegacyEquals)) {
                    throw new IllegalArgumentException(label + " requires value/equals in scenario: " + scenarioName);
                }
                break;
            case "in":
                if (!hasValues && !(hasValue || hasLegacyEquals)) {
                    throw new IllegalArgumentException(label + " requires values or value in scenario: " + scenarioName);
                }
                break;
            case "exists":
            case "notexists":
                break;
            default:
                throw new IllegalArgumentException("Unsupported condition operator at " + label + ": " + operator);
        }
    }

    private static boolean isValidCondition(ConfigModels.ConditionConfig condition) {
        return condition != null && !isBlank(condition.variable);
    }

    private static boolean hasCompleteLegacyCondition(ConfigModels.ConditionConfig condition) {
        return condition != null && !isBlank(condition.variable) && condition.equals != null;
    }

    private static String normalizeConditionOperator(ConfigModels.ConditionConfig condition) {
        if (condition == null) {
            return "";
        }
        if (!isBlank(condition.operator)) {
            return condition.operator.trim().toLowerCase(Locale.ROOT);
        }
        if (condition.equals != null) {
            return "equals";
        }
        return "exists";
    }

    private static void validateCheck(ConfigModels.CheckConfig check) {
        if (isBlank(check.type)) {
            throw new IllegalArgumentException("step.checks[].type is required.");
        }
        String type = check.type.trim().toLowerCase();
        switch (type) {
            case "bodycontains":
            case "regex":
                if (isBlank(check.value)) {
                    throw new IllegalArgumentException("step.checks[].value is required for type=" + check.type);
                }
                break;
            case "jsonpathexists":
                if (isBlank(check.path)) {
                    throw new IllegalArgumentException("step.checks[].path is required for type=" + check.type);
                }
                break;
            case "jsonpathequals":
                if (isBlank(check.path) || isBlank(check.value)) {
                    throw new IllegalArgumentException("step.checks[].path and value are required for type=" + check.type);
                }
                break;
            case "headerexists":
                if (isBlank(check.path)) {
                    throw new IllegalArgumentException("step.checks[].path(header name) is required for type=" + check.type);
                }
                break;
            case "headerequals":
                if (isBlank(check.path) || isBlank(check.value)) {
                    throw new IllegalArgumentException("step.checks[].path(header name) and value are required for type=" + check.type);
                }
                break;
            case "bodylengthgt":
                if (isBlank(check.value)) {
                    throw new IllegalArgumentException("step.checks[].value is required for type=" + check.type);
                }
                try {
                    Integer.parseInt(check.value.trim());
                } catch (NumberFormatException ex) {
                    throw new IllegalArgumentException("step.checks[].value must be integer for type=" + check.type);
                }
                break;
            case "jmespathexists":
                if (isBlank(check.path)) {
                    throw new IllegalArgumentException("step.checks[].path is required for type=" + check.type);
                }
                break;
            case "jmespathequals":
                if (isBlank(check.path) || isBlank(check.value)) {
                    throw new IllegalArgumentException("step.checks[].path and value are required for type=" + check.type);
                }
                break;
            case "statusin":
                if (isBlank(check.value)) {
                    throw new IllegalArgumentException("step.checks[].value is required for type=" + check.type);
                }
                break;
            default:
                throw new IllegalArgumentException("Unsupported step.checks[].type: " + check.type);
        }
    }

    private static void validateCapture(ConfigModels.CaptureConfig capture) {
        if (isBlank(capture.type) || isBlank(capture.path) || isBlank(capture.saveAs)) {
            throw new IllegalArgumentException("step.captures[] requires type, path, saveAs.");
        }
        String captureType = capture.type.trim().toLowerCase();
        if (!"jsonpath".equals(captureType)
                && !"header".equals(captureType)
                && !"regex".equals(captureType)) {
            throw new IllegalArgumentException("Unsupported step.captures[].type: " + capture.type);
        }
    }
}
