pipeline {
  agent any

  tools {
    jdk 'jdk17'
    maven 'maven3'
  }

  parameters {
    string(name: 'CONFIG_FILE', defaultValue: 'src/test/resources/sample-config.yaml', description: 'Path to Gatling YAML config file')
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Run Gatling') {
      steps {
        bat "mvn -B -Dgatling.simulationClass=com.example.gatling.simulations.ConfigDrivenApiSimulation -DconfigFile=%CONFIG_FILE% gatling:test"
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'target/gatling/**', allowEmptyArchive: true
    }
  }
}
