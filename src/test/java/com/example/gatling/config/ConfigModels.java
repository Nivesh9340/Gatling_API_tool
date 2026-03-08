package com.example.gatling.config;

import java.util.List;
import java.util.Map;

public final class ConfigModels {
    private ConfigModels() {
    }

    public static class TestPlan {
        public ServiceConfig service;
        public String activeEnvironment;
        public Map<String, ServiceConfig> environments;
        public Map<String, ApplicationConfig> applications;
        public List<ScenarioConfig> scenarios;
        public AssertionsConfig assertions;
    }

    public static class ApplicationConfig {
        public Boolean enabled;
        public ServiceConfig service;
        public String activeEnvironment;
        public Map<String, ServiceConfig> environments;
        public Map<String, LoadProfile> injectionProfiles;
        public List<ScenarioConfig> scenarios;
        public AssertionsConfig assertions;
    }

    public static class ServiceConfig {
        public String baseUrl;
        public Map<String, String> defaultHeaders;
        public AuthConfig auth;
        public TlsConfig tls;
    }

    public static class AuthConfig {
        public String type;
        public String tokenEnv;
        public String usernameEnv;
        public String passwordEnv;
        public String headerName;
        public String headerValueEnv;
    }

    public static class ScenarioConfig {
        public String name;
        public LoadProfile load;
        public FlowControl flow;
        public FeederConfig feeder;
        public List<RequestStep> steps;
    }

    public static class FlowControl {
        public Integer repeatCount;
        public Integer duringSec;
        public Boolean exitOnFail;
        public String asLongAsVariable;
        public String asLongAsEquals;
    }

    public static class LoadProfile {
        public String profileRef;
        public String injectionType;
        public Integer users;
        public Integer rampDurationSec;
        public Integer durationSec;
        public Integer paceMs;
        public Double rate;
        public Double fromRps;
        public Double toRps;
        public Double startRate;
        public Double incrementBy;
        public Integer levelCount;
        public Integer levelDurationSec;
        public Integer fromUsers;
        public Integer toUsers;
    }

    public static class RequestStep {
        public String name;
        public String method;
        public String path;
        public String url;
        public Map<String, String> headers;
        public Map<String, String> queryParams;
        public Map<String, String> formParams;
        public String body;
        public String bodyFile;
        public String bodyType;
        public List<FormUploadConfig> formUploads;
        public AuthConfig auth;
        public Boolean disableFollowRedirect;
        public Boolean disableUrlEncoding;
        public Boolean silent;
        public Boolean ignoreProtocolHeaders;
        public Integer requestTimeoutMs;
        public ConditionConfig condition;
        public List<ConditionalBranchConfig> branches;
        public ConditionalBranchConfig fallback;
        public Integer retryCount;
        public String elseMethod;
        public String elsePath;
        public String elseBody;
        public Integer elseExpectedStatus;
        public Integer expectedStatus;
        public Integer pauseMs;
        public List<CheckConfig> checks;
        public List<CaptureConfig> captures;
    }

    public static class ConditionConfig {
        public String variable;
        public String equals;
        public String operator;
        public String value;
        public List<String> values;
    }

    public static class ConditionalBranchConfig {
        public String name;
        public ConditionConfig when;
        public String method;
        public String path;
        public String url;
        public Map<String, String> headers;
        public Map<String, String> queryParams;
        public Map<String, String> formParams;
        public String body;
        public String bodyFile;
        public String bodyType;
        public List<FormUploadConfig> formUploads;
        public AuthConfig auth;
        public Boolean disableFollowRedirect;
        public Boolean disableUrlEncoding;
        public Boolean silent;
        public Boolean ignoreProtocolHeaders;
        public Integer requestTimeoutMs;
        public Integer retryCount;
        public Integer expectedStatus;
        public Integer pauseMs;
        public List<CheckConfig> checks;
        public List<CaptureConfig> captures;
    }

    public static class FeederConfig {
        public String type;
        public String file;
        public String mode;
    }

    public static class CheckConfig {
        public String type;
        public String path;
        public String value;
    }

    public static class CaptureConfig {
        public String type;
        public String path;
        public String saveAs;
    }

    public static class FormUploadConfig {
        public String fieldName;
        public String filePath;
    }

    public static class AssertionsConfig {
        public Double minSuccessPercent;
        public Integer maxResponseTimeMs;
        public Integer p90ResponseTimeMs;
        public Integer p95ResponseTimeMs;
        public Integer p99ResponseTimeMs;
        public Integer maxFailedRequests;
        public Double minRequestsPerSec;
    }

    public static class TlsConfig {
        public Boolean enabled;
        public String keyStorePath;
        public String keyStoreType;
        public String keyStorePasswordEnv;
        public String trustStorePath;
        public String trustStoreType;
        public String trustStorePasswordEnv;
        public Boolean insecureSkipTlsVerify;
    }
}
