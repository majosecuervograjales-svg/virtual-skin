
#include <stdio.h>
#include <stdbool.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"

#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "nvs_flash.h"
#include "freertos/event_groups.h"
#include "mqtt_client.h"


// ==========================================
// ASTRA - AUTONOMOUS SPACEFLIGHT TELEMETRY
// AND RESPONSIVE ASSISTANCE
// Firmware ESP32 - ESP-IDF
// ==========================================

// 1. CONFIGURACION DE PINES

#define SENSOR_FC    ADC_CHANNEL_6  // GPIO34
#define SENSOR_SPO2  ADC_CHANNEL_7  // GPIO35
#define SENSOR_FR    ADC_CHANNEL_4  // GPIO32

#define LED_VERDE       GPIO_NUM_18
#define LED_AMARILLO    GPIO_NUM_19
#define LED_ROJO        GPIO_NUM_21
#define BUZZER          GPIO_NUM_22
#define BOTON_EMERGENCIA GPIO_NUM_23

// 2. ESTRUCTURAS DE DATOS

typedef struct {
    float heart_rate;
    float oxygen_saturation;
    float respiratory_rate;
    bool signal_valid;
} HealthData;

typedef enum {
    STABLE,
    WARNING,
    EMERGENCY,
    SENSOR_ERROR
} HealthStatus;

// 3. VARIABLES GLOBALES

static adc_oneshot_unit_handle_t adc_handle;

#define WIFI_SSID "Wokwi-GUEST"

#define WIFI_CONECTADO BIT0

static EventGroupHandle_t wifi_event_group;

static void evento_wifi(
    void *arg,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data)
{
    if (event_base == WIFI_EVENT &&
        event_id == WIFI_EVENT_STA_START)
    {
        esp_wifi_connect();
    }

    else if (event_base == WIFI_EVENT &&
             event_id == WIFI_EVENT_STA_DISCONNECTED)
    {
        xEventGroupClearBits(
            wifi_event_group, WIFI_CONECTADO);

        printf("WiFi desconectado. Reconectando...\n");
        esp_wifi_connect();
    }

    else if (event_base == IP_EVENT &&
             event_id == IP_EVENT_STA_GOT_IP)
    {
        xEventGroupSetBits(
            wifi_event_group, WIFI_CONECTADO);

        printf("SKIN-LINK: WiFi conectado.\n");
    }
}
#define MQTT_BROKER "mqtt://broker.emqx.io:1883"
#define MQTT_TOPIC "virtualskin/demo2026/node01/telemetry"

static esp_mqtt_client_handle_t mqtt_cliente = NULL;
static bool mqtt_conectado = false;


// HISTORIAL DE FRECUENCIA CARDIACA

#define HISTORIAL_MAX 10

static float historial_fc[HISTORIAL_MAX];
static int historial_cantidad = 0;
static int historial_posicion = 0;

// 4. PROTOTIPOS DE FUNCIONES

void configurar_adc(void);
void configurar_salidas(void);
HealthData leer_sensores(void);
HealthStatus analizar_datos(HealthData datos);
void controlar_alertas(HealthStatus estado);
void mostrar_datos(HealthData datos, HealthStatus estado);

void registrar_historial(HealthData datos);
void analizar_tendencia(void);
void enviar_telemetria(HealthData datos, HealthStatus estado);
void conectar_wifi(void);
void iniciar_mqtt(void);
void publicar_mqtt(HealthData datos, HealthStatus estado);


// ==========================================
// 5. CONFIGURACION DEL ADC
// ==========================================

void configurar_adc(void)
{
    adc_oneshot_unit_init_cfg_t adc_config = {
        .unit_id = ADC_UNIT_1
    };

    ESP_ERROR_CHECK(
        adc_oneshot_new_unit(&adc_config, &adc_handle)
    );

    adc_oneshot_chan_cfg_t canal_config = {
        .bitwidth = ADC_BITWIDTH_12,
        .atten = ADC_ATTEN_DB_12
    };

    ESP_ERROR_CHECK(adc_oneshot_config_channel(
        adc_handle, SENSOR_FC, &canal_config));

    ESP_ERROR_CHECK(adc_oneshot_config_channel(
        adc_handle, SENSOR_SPO2, &canal_config));

    ESP_ERROR_CHECK(adc_oneshot_config_channel(
        adc_handle, SENSOR_FR, &canal_config));

    printf("ADC configurado correctamente.\n");
}

// ==========================================
// 6. CONFIGURACION DE SALIDAS
// ==========================================

void configurar_salidas(void)
{
    gpio_config_t salidas = {
        .pin_bit_mask =
            (1ULL << LED_VERDE) |
            (1ULL << LED_AMARILLO) |
            (1ULL << LED_ROJO) |
            (1ULL << BUZZER),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };

    ESP_ERROR_CHECK(gpio_config(&salidas));

    gpio_config_t boton = {
        .pin_bit_mask = (1ULL << BOTON_EMERGENCIA),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };

    ESP_ERROR_CHECK(gpio_config(&boton));

    gpio_set_level(LED_VERDE, 0);
    gpio_set_level(LED_AMARILLO, 0);
    gpio_set_level(LED_ROJO, 0);
    gpio_set_level(BUZZER, 0);

    printf("GPIO configurados correctamente.\n");
}

// ==========================================
// 7. LECTURA DE SENSORES
// ==========================================

HealthData leer_sensores(void)
{
    HealthData datos = {0};

    int lectura_fc = 0;
    int lectura_spo2 = 0;
    int lectura_fr = 0;

    esp_err_t error1 = adc_oneshot_read(
        adc_handle, SENSOR_FC, &lectura_fc);

    esp_err_t error2 = adc_oneshot_read(
        adc_handle, SENSOR_SPO2, &lectura_spo2);

    esp_err_t error3 = adc_oneshot_read(
        adc_handle, SENSOR_FR, &lectura_fr);

    datos.signal_valid =
        (error1 == ESP_OK &&
         error2 == ESP_OK &&
         error3 == ESP_OK &&
         lectura_fc >= 0 && lectura_fc <= 4095 &&
         lectura_spo2 >= 0 && lectura_spo2 <= 4095 &&
         lectura_fr >= 0 && lectura_fr <= 4095);

    if (!datos.signal_valid)
    {
        return datos;
    }

    // Conversion de ADC a valores simulados
    // No son mediciones fisiologicas reales

    datos.heart_rate =
        40.0f + (lectura_fc * 160.0f / 4095.0f);

    datos.oxygen_saturation =
        80.0f + (lectura_spo2 * 20.0f / 4095.0f);

    datos.respiratory_rate =
        5.0f + (lectura_fr * 35.0f / 4095.0f);

    return datos;
}

// ==========================================
// 8. ANALISIS DE DATOS
// ==========================================

HealthStatus analizar_datos(HealthData datos)
{
    // Prioridad al boton manual de emergencia
    if (gpio_get_level(BOTON_EMERGENCIA) == 0)
    {
        return EMERGENCY;
    }

    if (!datos.signal_valid)
    {
        return SENSOR_ERROR;
    }

    // Umbrales didacticos para simulacion
    if (datos.heart_rate < 40 ||
        datos.heart_rate > 120 ||
        datos.oxygen_saturation < 90 ||
        datos.respiratory_rate < 8 ||
        datos.respiratory_rate > 25)
    {
        return EMERGENCY;
    }

    if (datos.heart_rate < 50 ||
        datos.heart_rate > 100 ||
        datos.oxygen_saturation < 95 ||
        datos.respiratory_rate < 12 ||
        datos.respiratory_rate > 20)
    {
        return WARNING;
    }

    return STABLE;
}

// ==========================================
// 9. CONTROL DE ALERTAS
// ==========================================

void controlar_alertas(HealthStatus estado)
{
    gpio_set_level(LED_VERDE,
                   estado == STABLE);

    gpio_set_level(LED_AMARILLO,
                   estado == WARNING);

    gpio_set_level(LED_ROJO,
                   estado == EMERGENCY ||
                   estado == SENSOR_ERROR);

    gpio_set_level(BUZZER,
                   estado == EMERGENCY);
}

// ==========================================
// 10. VISUALIZACION DE DATOS
// ==========================================

void mostrar_datos(HealthData datos, HealthStatus estado)
{
    printf("\n=================================\n");
    printf("       ASTRA HEALTH MONITOR      \n");
    printf("=================================\n");

    if (datos.signal_valid)
    {
        printf("Frecuencia cardiaca: %.1f lpm\n",
               datos.heart_rate);

        printf("Saturacion SpO2: %.1f %%\n",
               datos.oxygen_saturation);

        printf("Frecuencia respiratoria: %.1f rpm\n",
               datos.respiratory_rate);
    }
    else
    {
        printf("Lectura ADC no valida.\n");
    }

    switch (estado)
    {
        case STABLE:
            printf("ESTADO: ESTABLE\n");
            break;

        case WARNING:
            printf("ESTADO: PRECAUCION\n");
            printf("ACCION: Verificar parametros.\n");
            break;

        case EMERGENCY:
            printf("ESTADO: EMERGENCIA\n");
            printf("ACCION: Solicitar evaluacion.\n");
            break;

        case SENSOR_ERROR:
            printf("ESTADO: ERROR DE SENSOR\n");
            printf("ACCION: Revisar adquisicion.\n");
            break;
    }

    printf("=================================\n");
}

// ==========================================
// 11. PROGRAMA PRINCIPAL
// ==========================================

void enviar_telemetria(HealthData datos, HealthStatus estado)
{
    const char *nombre_estado;

    switch (estado)
    {
        case STABLE:
            nombre_estado = "stable";
            break;

        case WARNING:
            nombre_estado = "warning";
            break;

        case EMERGENCY:
            nombre_estado = "emergency";
            break;

        default:
            nombre_estado = "sensor_error";
            break;
    }

    if (!datos.signal_valid)
    {
        printf(
            "SKIN_JSON:{\"valid\":false,"
            "\"status\":\"%s\"}\n",
            nombre_estado
        );
        return;
    }

    printf(
        "SKIN_JSON:{\"valid\":true,"
        "\"hr\":%.1f,"
        "\"spo2\":%.1f,"
        "\"rr\":%.1f,"
        "\"status\":\"%s\"}\n",
        datos.heart_rate,
        datos.oxygen_saturation,
        datos.respiratory_rate,
        nombre_estado
    );
}

void conectar_wifi(void)
{
    esp_err_t ret = nvs_flash_init();

    if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND)
    {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }

    ESP_ERROR_CHECK(ret);

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    esp_netif_create_default_wifi_sta();


    wifi_event_group = xEventGroupCreate();

if (wifi_event_group == NULL)
{
    printf("ERROR: No se pudo crear el grupo WiFi.\n");
    return;
}

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();

    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_register(
        WIFI_EVENT,
        ESP_EVENT_ANY_ID,
        &evento_wifi,
        NULL));

    ESP_ERROR_CHECK(esp_event_handler_register(
        IP_EVENT,
        IP_EVENT_STA_GOT_IP,
        &evento_wifi,
        NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = "",
            .channel = 6,
            .threshold.authmode = WIFI_AUTH_OPEN
        }
    };

    ESP_ERROR_CHECK(
        esp_wifi_set_mode(WIFI_MODE_STA));

    ESP_ERROR_CHECK(
        esp_wifi_set_config(WIFI_IF_STA, &wifi_config));

    ESP_ERROR_CHECK(esp_wifi_start());

    printf("SKIN-LINK: Conectando a WiFi...\n");
}

static void evento_mqtt(
    void *arg,
    esp_event_base_t base,
    int32_t evento,
    void *datos_evento)
{
    switch (evento)
    {
        case MQTT_EVENT_CONNECTED:
            mqtt_conectado = true;
            printf("SKIN-LINK: MQTT conectado.\n");
            break;

        case MQTT_EVENT_DISCONNECTED:
            mqtt_conectado = false;
            printf("SKIN-LINK: MQTT desconectado.\n");
            break;

        case MQTT_EVENT_ERROR:
            printf("SKIN-LINK: Error MQTT.\n");
            break;

        default:
            break;
    }
}

void iniciar_mqtt(void)
{
    esp_mqtt_client_config_t config = {
        .broker.address.uri = MQTT_BROKER
    };

    mqtt_cliente = esp_mqtt_client_init(&config);

    if (mqtt_cliente == NULL)
    {
        printf("ERROR: No se pudo crear MQTT.\n");
        return;
    }

    ESP_ERROR_CHECK(
        esp_mqtt_client_register_event(
            mqtt_cliente,
            ESP_EVENT_ANY_ID,
            evento_mqtt,
            NULL
        )
    );

    ESP_ERROR_CHECK(
        esp_mqtt_client_start(mqtt_cliente)
    );

    printf("SKIN-LINK: Iniciando MQTT...\n");
}

void publicar_mqtt(HealthData datos, HealthStatus estado)
{
    if (!mqtt_conectado || mqtt_cliente == NULL)
    {
        return;
    }

    const char *nombre_estado = "sensor_error";

    switch (estado)
    {
        case STABLE:
            nombre_estado = "stable";
            break;
        case WARNING:
            nombre_estado = "warning";
            break;
        case EMERGENCY:
            nombre_estado = "emergency";
            break;
        default:
            break;
    }

    char mensaje[200];

    if (!datos.signal_valid)
    {
        snprintf(
            mensaje, sizeof(mensaje),
            "{\"valid\":false,\"status\":\"%s\"}",
            nombre_estado
        );
    }
    else
    {
        snprintf(
            mensaje, sizeof(mensaje),
            "{\"valid\":true,\"hr\":%.1f,"
            "\"spo2\":%.1f,\"rr\":%.1f,"
            "\"status\":\"%s\"}",
            datos.heart_rate,
            datos.oxygen_saturation,
            datos.respiratory_rate,
            nombre_estado
        );
    }

    int resultado = esp_mqtt_client_publish(
        mqtt_cliente,
        MQTT_TOPIC,
        mensaje,
        0,
        0,
        0
    );

    if (resultado >= 0)
    {
        printf("SKIN-MQTT: Publicacion encolada: %s\n",
               mensaje);
    }
    else
    {
        printf("SKIN-MQTT: Error al publicar.\n");
    }
}

void app_main(void)
{
    
configurar_adc();
configurar_salidas();
conectar_wifi();

printf("Esperando conexion WiFi...\n");

EventBits_t bits = xEventGroupWaitBits(
    wifi_event_group,
    WIFI_CONECTADO,
    pdFALSE,
    pdFALSE,
    pdMS_TO_TICKS(15000)
);

if (bits & WIFI_CONECTADO)
{
    printf("WiFi listo. Iniciando MQTT...\n");
    iniciar_mqtt();
}
else
{
    printf("WiFi no disponible. Modo local activo.\n");
}


    printf("\n");
    printf("=================================\n");
    printf("      ASTRA - SISTEMA ACTIVO     \n");
    printf("=================================\n");
    printf("Modo: SIMULACION FISIOLOGICA\n");

    while (1)
    {
        HealthData datos = leer_sensores();

        HealthStatus estado = analizar_datos(datos);

        controlar_alertas(estado);

        mostrar_datos(datos, estado);
        enviar_telemetria(datos, estado);
        publicar_mqtt(datos, estado);

        registrar_historial(datos);
        analizar_tendencia();

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}


// ==========================================
// 12. REGISTRO DE HISTORIAL
// ==========================================

void registrar_historial(HealthData datos)
{
    if (!datos.signal_valid)
    {
        return;
    }

    historial_fc[historial_posicion] =
        datos.heart_rate;

    historial_posicion =
        (historial_posicion + 1) % HISTORIAL_MAX;

    if (historial_cantidad < HISTORIAL_MAX)
    {
        historial_cantidad++;
    }
}

// ==========================================
// 13. ANALISIS DE TENDENCIAS
// ==========================================

void analizar_tendencia(void)
{
    if (historial_cantidad < HISTORIAL_MAX)
    {
        printf("Historial: %d/%d lecturas\n",
               historial_cantidad, HISTORIAL_MAX);
        return;
    }

    float suma = 0;

    for (int i = 0; i < HISTORIAL_MAX; i++)
    {
        suma += historial_fc[i];
    }

    float promedio = suma / HISTORIAL_MAX;

    // La posicion actual apunta al dato mas antiguo
    float primer_valor =
        historial_fc[historial_posicion];

    int indice_ultimo =
        (historial_posicion + HISTORIAL_MAX - 1)
        % HISTORIAL_MAX;

    float ultimo_valor =
        historial_fc[indice_ultimo];

    float diferencia = ultimo_valor - primer_valor;

    printf("Promedio FC: %.1f lpm\n", promedio);
    printf("Cambio FC: %.1f lpm\n", diferencia);

    if (diferencia >= 15.0f)
    {
        printf("TENDENCIA: AUMENTO DE FC\n");
        printf("SUGERENCIA: Revisar actividad y contexto.\n");
    }
    else if (diferencia <= -15.0f)
    {
        printf("TENDENCIA: DISMINUCION DE FC\n");
    }
    else
    {
        printf("TENDENCIA: SIN CAMBIO NETO IMPORTANTE\n");
    }
}

