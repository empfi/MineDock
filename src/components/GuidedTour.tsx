import { useState, useEffect } from 'react';
import { Joyride, STATUS, Step, EventData } from 'react-joyride';
import { useLocation } from 'react-router-dom';

export default function GuidedTour() {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const location = useLocation();

  useEffect(() => {
    const seen = localStorage.getItem('minedock_tour_seen');
    if (!seen) {
      setRun(true);
    }
  }, []);

  useEffect(() => {
    if (run) {
      if (location.pathname === '/servers' && stepIndex === 0) {
        setStepIndex(1);
      } else if (location.pathname === '/wizard' && stepIndex === 1) {
        setStepIndex(2);
      } else if (location.pathname === '/servers' && (stepIndex === 2 || stepIndex === 3)) {
        // Resume tour at the start button when they return to servers page
        setStepIndex(4);
      }
    }
  }, [location.pathname, run, stepIndex]);

  const steps: Step[] = [
    {
      target: '#tour-servers-tab',
      content: 'Welcome to MineDock! To get started, click the Servers tab to view your hosts.',
      skipBeacon: true,
      skipScroll: true,
      buttons: ['skip'],
      overlayClickAction: false,
      placement: 'right',
    },
    {
      target: '#tour-create-server',
      content: 'Click here to create your very first Minecraft server.',
      skipBeacon: true,
      skipScroll: true,
      buttons: ['skip'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-server-name',
      content: 'Give your server a cool name.',
      skipBeacon: true,
      skipScroll: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'bottom',
      styles: {
        tooltipFooter: {
          display: 'none',
        }
      }
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next to proceed through the configuration steps and finish creating your server!',
      skipBeacon: true,
      skipScroll: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: {
        tooltipFooter: {
          display: 'none',
        }
      }
    },
    {
      target: '#tour-start-server-container',
      content: 'Your server is ready! Click the Play button to start it up. That is the end of the tutorial, enjoy MineDock!',
      skipBeacon: true,
      skipScroll: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'left',
    }
  ];

  const handleCallback = (data: EventData) => {
    const { action, index, status, type } = data;
    
    if (type === 'step:after') {
      if (action === 'next') setStepIndex(index + 1);
      if (action === 'prev') setStepIndex(index - 1);
    }
    
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      localStorage.setItem('minedock_tour_seen', 'true');
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      onEvent={handleCallback}
      continuous
      options={{
        arrowColor: '#1c1d21',
        backgroundColor: '#1c1d21',
        overlayColor: 'rgba(0, 0, 0, 0.7)',
        primaryColor: '#2563eb',
        textColor: '#e5e7eb',
        zIndex: 10000,
        showProgress: true,
        spotlightPadding: 4,
      }}
      styles={{
        tooltipContainer: {
          textAlign: 'left',
          fontSize: '14px',
        },
        buttonPrimary: {
          backgroundColor: '#2563eb',
          borderRadius: '6px',
        },
        buttonBack: {
          color: '#9ca3af',
          marginRight: '10px',
        },
        buttonSkip: {
          color: '#6b7280',
        }
      }}
    />
  );
}
