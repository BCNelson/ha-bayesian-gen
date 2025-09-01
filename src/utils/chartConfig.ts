export interface ChartConfig {
  height: number
  threshold: number
}

export const createBayesianChartOptions = (config: ChartConfig) => ({
  chart: {
    id: 'bayesian-probability',
    type: 'line',
    height: config.height,
    animations: {
      enabled: false, // Disable animations for better performance
      easing: 'easeinout',
      speed: 200
    },
    toolbar: {
      show: true,
      tools: {
        download: true,
        selection: true,
        zoom: true,
        zoomin: true,
        zoomout: true,
        pan: true,
        reset: true
      }
    },
    zoom: {
      enabled: true,
      type: 'x',
      autoScaleYaxis: true
    }
  },
  stroke: {
    curve: 'stepline',
    width: 2
  },
  xaxis: {
    title: {
      text: 'Time'
    },
    type: 'datetime',
    labels: {
      datetimeUTC: false,
      format: 'HH:mm'
    }
  },
  yaxis: {
    title: {
      text: 'Probability (%)'
    },
    min: 0,
    max: 100,
    labels: {
      formatter: (value: number) => `${value.toFixed(0)}%`
    }
  },
  annotations: {
    yaxis: [
      {
        y: config.threshold * 100,
        borderColor: '#FF4560',
        borderWidth: 2,
        strokeDashArray: 5,
        label: {
          borderColor: '#FF4560',
          style: {
            color: '#fff',
            background: '#FF4560'
          },
          text: `Threshold (${(config.threshold * 100).toFixed(0)}%)`
        }
      }
    ]
  },
  colors: ['#2196F3', '#4CAF50'],
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.7,
      opacityTo: 0.3
    }
  },
  markers: {
    size: 0
  },
  legend: {
    show: true,
    showForSingleSeries: false
  },
  grid: {
    borderColor: '#e7e7e7',
    row: {
      colors: ['#f3f3f3', 'transparent'],
      opacity: 0.5
    }
  },
  tooltip: {
    x: {
      format: 'dd MMM HH:mm'
    },
    y: {
      formatter: (value: number) => `${value.toFixed(1)}%`
    }
  },
  dataLabels: {
    enabled: false
  }
})

export const transformSimulationData = (points: Array<{timestamp: Date, probability: number, sensorState: boolean}>) => {
  // Optimize data transformation for large datasets
  const dataLength = points.length
  const probabilityData = new Array(dataLength)
  const stateData = new Array(dataLength)
  
  for (let i = 0; i < dataLength; i++) {
    const point = points[i]
    const timestamp = point.timestamp.getTime()
    probabilityData[i] = { x: timestamp, y: point.probability * 100 }
    stateData[i] = { x: timestamp, y: point.sensorState ? 100 : 0 }
  }

  return [
    {
      name: 'Probability',
      data: probabilityData
    },
    {
      name: 'Sensor State (ON/OFF)',
      data: stateData
    }
  ]
}